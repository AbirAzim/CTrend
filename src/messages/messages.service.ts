import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './conversation.schema';
import { Message, MessageDocument } from './message.schema';
import { UsersService } from '../users/users.service';
import { FollowsService } from '../follows/follows.service';
import { PresenceService } from '../presence/presence.service';
import {
  ConversationGql,
  MessageGql,
  ParticipantGql,
} from './graphql/message.types';
import { pubsub, NEW_MESSAGE, MESSAGE_READ, TYPING_INDICATOR } from '../pubsub';
import { UserRole } from '../common/enums';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    private usersService: UsersService,
    private followsService: FollowsService,
    private presenceService: PresenceService,
  ) {}

  // ── Conversations ──────────────────────────────────────────────

  async getOrCreateDirect(
    viewerId: string,
    targetUserId: string,
    viewerRole: string,
  ): Promise<ConversationDocument> {
    if (viewerId === targetUserId) {
      throw new BadRequestException('Cannot message yourself');
    }

    const target = await this.usersService.findById(targetUserId);
    if (!target) throw new NotFoundException('User not found');

    // Only admins can DM non-friends
    if (viewerRole !== UserRole.ADMIN) {
      const status = await this.followsService.getFriendshipStatus(
        viewerId,
        targetUserId,
      );
      if (status !== 'FRIEND') {
        throw new ForbiddenException('You can only message friends');
      }
    }

    const viewerOid = new Types.ObjectId(viewerId);
    const targetOid = new Types.ObjectId(targetUserId);

    const existing = await this.conversationModel
      .findOne({
        type: 'direct',
        participantIds: { $all: [viewerOid, targetOid], $size: 2 },
      })
      .exec();

    if (existing) return existing;

    return this.conversationModel.create({
      type: 'direct',
      participantIds: [viewerOid, targetOid],
      createdBy: viewerOid,
      unreadCounts: {},
    });
  }

  async createGroup(
    viewerId: string,
    memberIds: string[],
    name: string,
  ): Promise<ConversationDocument> {
    if (memberIds.length < 2) {
      throw new BadRequestException('Group needs at least 2 other members');
    }
    const unique = Array.from(new Set([viewerId, ...memberIds]));
    const participantOids = unique.map((id) => new Types.ObjectId(id));
    return this.conversationModel.create({
      type: 'group',
      participantIds: participantOids,
      name: name.trim() || 'Group chat',
      createdBy: new Types.ObjectId(viewerId),
      unreadCounts: {},
    });
  }

  async myConversations(viewerId: string): Promise<ConversationGql[]> {
    const viewerOid = new Types.ObjectId(viewerId);
    const convos = await this.conversationModel
      .find({ participantIds: viewerOid })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .limit(50)
      .exec();
    return Promise.all(convos.map((c) => this.toGql(c, viewerId)));
  }

  // ── Messages ──────────────────────────────────────────────────

  async sendMessage(
    viewerId: string,
    conversationId: string,
    text: string,
    imageUrl?: string,
  ): Promise<MessageGql> {
    const trimmedText = text?.trim() ?? '';
    if (!trimmedText && !imageUrl) {
      throw new BadRequestException('Message must contain text or an image');
    }

    const convo = await this.conversationModel.findById(conversationId).exec();
    if (!convo) throw new NotFoundException('Conversation not found');

    const viewerOid = new Types.ObjectId(viewerId);
    if (!convo.participantIds.some((id) => id.equals(viewerOid))) {
      throw new ForbiddenException('Not a participant');
    }

    const msg = await this.messageModel.create({
      conversationId: convo._id,
      senderId: viewerOid,
      text: trimmedText,
      imageUrl: imageUrl ?? null,
      readBy: [{ userId: viewerOid, readAt: new Date() }],
    });

    // Increment unread counts for all other participants
    const updates: Record<string, number> = {};
    for (const pid of convo.participantIds) {
      if (!pid.equals(viewerOid)) {
        updates[`unreadCounts.${pid.toHexString()}`] =
          (convo.unreadCounts?.[pid.toHexString()] ?? 0) + 1;
      }
    }

    // Preview text shown in conversation list
    const previewText = trimmedText || '📷 Image';
    await this.conversationModel.updateOne(
      { _id: convo._id },
      {
        $set: {
          lastMessageText: previewText.slice(0, 100),
          lastMessageAt: msg.createdAt,
          ...updates,
        },
      },
    );

    const gql = await this.messageToGql(msg);

    await pubsub.publish(NEW_MESSAGE, {
      newMessage: gql,
      conversationId: convo._id.toHexString(),
      participantIds: convo.participantIds.map((id) => id.toHexString()),
    });

    // NOTE: We intentionally do NOT create bell-icon notifications for chat
    // messages. Unread message counts are tracked per-conversation via
    // unreadCounts on the Conversation document and surfaced through the
    // messenger FAB badge, not the notification bell.

    return gql;
  }

  async getMessages(
    viewerId: string,
    conversationId: string,
    skip = 0,
    take = 30,
  ): Promise<MessageGql[]> {
    const convo = await this.conversationModel.findById(conversationId).exec();
    if (!convo) throw new NotFoundException('Conversation not found');

    const viewerOid = new Types.ObjectId(viewerId);
    if (!convo.participantIds.some((id) => id.equals(viewerOid))) {
      throw new ForbiddenException('Not a participant');
    }

    const msgs = await this.messageModel
      .find({ conversationId: convo._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(take)
      .exec();

    return Promise.all(msgs.reverse().map((m) => this.messageToGql(m)));
  }

  async markRead(viewerId: string, conversationId: string): Promise<boolean> {
    const convo = await this.conversationModel.findById(conversationId).exec();
    if (!convo) return false;
    const viewerOid = new Types.ObjectId(viewerId);
    if (!convo.participantIds.some((id) => id.equals(viewerOid))) return false;

    const now = new Date();
    const result = await this.messageModel.updateMany(
      {
        conversationId: convo._id,
        'readBy.userId': { $ne: viewerOid },
      },
      { $push: { readBy: { userId: viewerOid, readAt: now } } },
    );

    // Always reset unread counter for this user
    await this.conversationModel.updateOne(
      { _id: convo._id },
      { $set: { [`unreadCounts.${viewerId}`]: 0 } },
    );

    // Only broadcast if there were genuinely unread messages — avoids
    // redundant subscription events when the conversation is already read.
    if (result.modifiedCount > 0) {
      await pubsub.publish(MESSAGE_READ, {
        messageRead: {
          conversationId: convo._id.toHexString(),
          userId: viewerId,
          readAt: now,
        },
        participantIds: convo.participantIds.map((id) => id.toHexString()),
      });
    }

    return true;
  }

  async setTyping(
    viewerId: string,
    conversationId: string,
    isTyping: boolean,
  ): Promise<boolean> {
    await pubsub.publish(TYPING_INDICATOR, {
      typingIndicator: { conversationId, userId: viewerId, isTyping },
    });
    return true;
  }

  // ── Serialisation ─────────────────────────────────────────────

  private async toGql(
    convo: ConversationDocument,
    viewerId: string,
  ): Promise<ConversationGql> {
    const participants = await Promise.all(
      convo.participantIds.map(async (id): Promise<ParticipantGql> => {
        const uid = id.toHexString();
        const u = await this.usersService.findById(uid);
        return {
          id: uid,
          displayName: u?.displayName?.trim() || u?.username || 'User',
          avatarUrl: u?.profileImageUrl ?? undefined,
          online: this.presenceService.isOnline(uid),
        };
      }),
    );
    return {
      id: convo._id.toHexString(),
      type: convo.type,
      participantIds: convo.participantIds.map((id) => id.toHexString()),
      participants,
      name: convo.name,
      lastMessageText: convo.lastMessageText,
      lastMessageAt: convo.lastMessageAt,
      unreadCount: convo.unreadCounts?.[viewerId] ?? 0,
      createdAt: (convo as any).createdAt,
    };
  }

  async conversationToGql(
    convo: ConversationDocument,
    viewerId: string,
  ): Promise<ConversationGql> {
    return this.toGql(convo, viewerId);
  }

  private async messageToGql(msg: MessageDocument): Promise<MessageGql> {
    const sender = await this.usersService.findById(msg.senderId.toHexString());
    return {
      id: msg._id.toHexString(),
      conversationId: msg.conversationId.toHexString(),
      senderId: msg.senderId.toHexString(),
      senderName: sender?.displayName?.trim() || sender?.username || 'User',
      senderAvatar: sender?.profileImageUrl ?? undefined,
      text: msg.text ?? '',
      imageUrl: msg.imageUrl ?? undefined,
      readBy: msg.readBy.map((r) => ({
        userId: r.userId.toHexString(),
        readAt: r.readAt,
      })),
      createdAt: (msg as any).createdAt,
    };
  }
}
