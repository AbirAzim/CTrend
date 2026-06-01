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
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import {
  ConversationGql,
  MessageGql,
  ModeratorMessageAdminGql,
  ModeratorThreadAdminGql,
  ParticipantGql,
  AdminModeratorUserMessageGql,
} from './graphql/message.types';
import {
  pubsub,
  NEW_MESSAGE,
  ADMIN_MODERATOR_USER_MESSAGE,
  MESSAGE_READ,
  TYPING_INDICATOR,
} from '../pubsub';
import { UserRole } from '../common/enums';
import {
  MODERATOR_ADMIN_UNREAD_KEY,
  MODERATOR_AVATAR_URL,
  MODERATOR_DISPLAY_NAME,
  MODERATOR_SENDER_GQL_ID,
  MODERATOR_SENDER_OBJECT_ID,
} from './moderator.constants';

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
    private notificationsService: NotificationsService,
    private pushService: PushService,
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

  // ── Moderator (platform) messages ─────────────────────────────

  private requireUserObjectId(
    userId: string,
    label = 'userId',
  ): Types.ObjectId {
    const trimmed = userId?.trim();
    if (!trimmed || !Types.ObjectId.isValid(trimmed)) {
      throw new BadRequestException(`Invalid ${label}`);
    }
    return new Types.ObjectId(trimmed);
  }

  /** Real recipient on a moderator thread (never the virtual moderator sentinel). */
  private extractModeratorRecipientId(
    convo: ConversationDocument,
  ): string | null {
    const sentinelHex = MODERATOR_SENDER_OBJECT_ID;
    for (const pid of convo.participantIds) {
      const hex = pid.toHexString();
      if (hex === sentinelHex || hex === MODERATOR_SENDER_GQL_ID) continue;
      if (Types.ObjectId.isValid(hex)) return hex;
    }
    return null;
  }

  private async findModeratorConversationForRecipient(
    targetUserId: string,
  ): Promise<ConversationDocument | null> {
    const targetOid = this.requireUserObjectId(targetUserId);
    return this.conversationModel
      .findOne({
        type: 'moderator',
        participantIds: targetOid,
      })
      .exec();
  }

  async getOrCreateModeratorConversation(
    targetUserId: string,
    adminId: string,
  ): Promise<ConversationDocument> {
    const target = await this.usersService.findById(targetUserId);
    if (!target) throw new NotFoundException('User not found');

    const targetOid = this.requireUserObjectId(targetUserId);
    const existing = await this.conversationModel
      .findOne({
        type: 'moderator',
        participantIds: targetOid,
      })
      .exec();

    if (existing) return existing;

    return this.conversationModel.create({
      type: 'moderator',
      participantIds: [targetOid],
      name: MODERATOR_DISPLAY_NAME,
      createdBy: new Types.ObjectId(adminId),
      unreadCounts: {},
    });
  }

  async sendModeratorMessage(
    adminId: string,
    targetUserId: string,
    text: string,
    imageUrl?: string,
  ): Promise<ModeratorMessageAdminGql> {
    const trimmedText = text?.trim() ?? '';
    if (!trimmedText && !imageUrl) {
      throw new BadRequestException('Message must contain text or an image');
    }

    const convo = await this.getOrCreateModeratorConversation(
      targetUserId,
      adminId,
    );
    const moderatorSenderOid = new Types.ObjectId(MODERATOR_SENDER_OBJECT_ID);

    const msg = await this.messageModel.create({
      conversationId: convo._id,
      senderId: moderatorSenderOid,
      sentByAdminId: new Types.ObjectId(adminId),
      isModeratorMessage: true,
      text: trimmedText,
      imageUrl: imageUrl ?? null,
      readBy: [],
    });

    const previewText = trimmedText || '📷 Image';
    await this.conversationModel.updateOne(
      { _id: convo._id },
      {
        $set: {
          lastMessageText: previewText.slice(0, 100),
          lastMessageAt: msg.createdAt,
          [`unreadCounts.${targetUserId}`]:
            (convo.unreadCounts?.[targetUserId] ?? 0) + 1,
        },
      },
    );

    const userGql = await this.messageToGql(msg, targetUserId);
    await pubsub.publish(NEW_MESSAGE, {
      newMessage: userGql,
      conversationId: convo._id.toHexString(),
      participantIds: [targetUserId],
    });

    await this.notificationsService.create({
      userId: targetUserId,
      type: 'MESSAGE',
      title: 'Official admin message',
      body: previewText.slice(0, 140),
      referenceId: convo._id.toHexString(),
      referenceType: 'moderator_conversation',
    });

    return this.moderatorMessageAdminGql(msg);
  }

  async sendModeratorMessages(
    adminId: string,
    userIds: string[],
    text: string,
    imageUrl?: string,
  ): Promise<ModeratorMessageAdminGql[]> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    const results: ModeratorMessageAdminGql[] = [];
    for (const userId of unique) {
      results.push(
        await this.sendModeratorMessage(adminId, userId, text, imageUrl),
      );
    }
    return results;
  }

  async listModeratorMessagesForAdmin(
    skip = 0,
    take = 50,
    search?: string,
  ): Promise<ModeratorMessageAdminGql[]> {
    const trimmedSearch = search?.trim().toLowerCase();
    let conversationIds: Types.ObjectId[] | null = null;

    if (trimmedSearch) {
      const convos = await this.conversationModel
        .find({ type: 'moderator' })
        .exec();
      const matched: Types.ObjectId[] = [];
      for (const convo of convos) {
        const recipientId = this.extractModeratorRecipientId(convo);
        if (!recipientId) continue;
        const user = await this.usersService.findById(recipientId);
        if (!user) continue;
        const haystack = [user.email, user.username, user.displayName ?? '']
          .join(' ')
          .toLowerCase();
        if (haystack.includes(trimmedSearch)) {
          matched.push(convo._id);
        }
      }
      conversationIds = matched;
      if (conversationIds.length === 0) return [];
    }

    const filter: Record<string, unknown> = { isModeratorMessage: true };
    if (conversationIds) {
      filter.conversationId = { $in: conversationIds };
    }

    const msgs = await this.messageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(take)
      .exec();

    return Promise.all(msgs.map((m) => this.moderatorMessageAdminGql(m)));
  }

  async countModeratorMessagesForAdmin(search?: string): Promise<number> {
    const trimmedSearch = search?.trim().toLowerCase();
    if (!trimmedSearch) {
      return this.messageModel
        .countDocuments({ isModeratorMessage: true })
        .exec();
    }

    const convos = await this.conversationModel
      .find({ type: 'moderator' })
      .exec();
    const matched: Types.ObjectId[] = [];
    for (const convo of convos) {
      const recipientId = this.extractModeratorRecipientId(convo);
      if (!recipientId) continue;
      const user = await this.usersService.findById(recipientId);
      if (!user) continue;
      const haystack = [user.email, user.username, user.displayName ?? '']
        .join(' ')
        .toLowerCase();
      if (haystack.includes(trimmedSearch)) {
        matched.push(convo._id);
      }
    }
    if (matched.length === 0) return 0;
    return this.messageModel
      .countDocuments({
        isModeratorMessage: true,
        conversationId: { $in: matched },
      })
      .exec();
  }

  async listModeratorThreadsForAdmin(
    skip = 0,
    take = 50,
    search?: string,
  ): Promise<ModeratorThreadAdminGql[]> {
    const convos = await this.conversationModel
      .find({ type: 'moderator' })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(take)
      .exec();

    const rows = await Promise.all(
      convos.map((c) => this.moderatorThreadAdminGql(c)),
    );

    const trimmedSearch = search?.trim().toLowerCase();
    if (!trimmedSearch) return rows;

    return rows.filter((row) => {
      const haystack = [row.recipientEmail, row.recipientName]
        .join(' ')
        .toLowerCase();
      return haystack.includes(trimmedSearch);
    });
  }

  async getModeratorThreadMessagesForAdmin(
    targetUserId: string,
  ): Promise<MessageGql[]> {
    const convo =
      await this.findModeratorConversationForRecipient(targetUserId);
    if (!convo) return [];

    const resolvedUserId =
      this.extractModeratorRecipientId(convo) ?? targetUserId.trim();

    const msgs = await this.messageModel
      .find({ conversationId: convo._id })
      .sort({ createdAt: 1 })
      .exec();

    return Promise.all(
      msgs.map((m) => this.messageToGql(m, resolvedUserId, true)),
    );
  }

  async markModeratorThreadReadForAdmin(
    targetUserId: string,
  ): Promise<boolean> {
    const convo =
      await this.findModeratorConversationForRecipient(targetUserId);
    if (!convo) return false;

    await this.conversationModel.updateOne(
      { _id: convo._id },
      { $set: { [`unreadCounts.${MODERATOR_ADMIN_UNREAD_KEY}`]: 0 } },
    );
    return true;
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

    // User reply in a moderator thread → notify admins via unread bucket + subscription
    if (convo.type === 'moderator') {
      updates[`unreadCounts.${MODERATOR_ADMIN_UNREAD_KEY}`] =
        (convo.unreadCounts?.[MODERATOR_ADMIN_UNREAD_KEY] ?? 0) + 1;
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

    const gql = await this.messageToGql(msg, viewerId);

    await pubsub.publish(NEW_MESSAGE, {
      newMessage: gql,
      conversationId: convo._id.toHexString(),
      participantIds: convo.participantIds.map((id) => id.toHexString()),
    });

    if (convo.type === 'moderator') {
      const recipientUserId = this.extractModeratorRecipientId(convo) ?? '';
      const unreadFromUserCount =
        updates[`unreadCounts.${MODERATOR_ADMIN_UNREAD_KEY}`] ?? 1;
      await pubsub.publish(ADMIN_MODERATOR_USER_MESSAGE, {
        adminModeratorUserMessage: {
          conversationId: convo._id.toHexString(),
          recipientUserId,
          message: await this.messageToGql(msg, undefined, true),
          unreadFromUserCount,
          lastMessageText: previewText.slice(0, 100),
          lastMessageAt: msg.createdAt,
        } satisfies AdminModeratorUserMessageGql,
      });
    }

    // NOTE: We intentionally do NOT create bell-icon notifications for chat
    // messages. Unread message counts are tracked per-conversation via
    // unreadCounts on the Conversation document and surfaced through the
    // messenger FAB badge, not the notification bell.

    // Mobile push: send a data-only, high-priority FCM message to every other
    // participant so their app (even backgrounded) can surface the message.
    // Tokens are looked up inside PushService; recipients without one are skipped.
    const recipientIds = convo.participantIds
      .filter((pid) => !pid.equals(viewerOid))
      .map((pid) => pid.toHexString());
    await Promise.all(
      recipientIds.map((recipientId) =>
        this.pushService.sendDataToUser(recipientId, {
          type: 'MESSAGE',
          conversationId: convo._id.toHexString(),
          senderName: gql.senderName,
          senderAvatar: gql.senderAvatar ?? '',
          body: gql.text ?? '',
        }),
      ),
    );

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

    return Promise.all(
      msgs.reverse().map((m) => this.messageToGql(m, viewerId)),
    );
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
    if (convo.type === 'moderator') {
      const participants: ParticipantGql[] = [
        {
          id: MODERATOR_SENDER_GQL_ID,
          displayName: MODERATOR_DISPLAY_NAME,
          avatarUrl: MODERATOR_AVATAR_URL,
          online: false,
        },
      ];

      for (const id of convo.participantIds) {
        const uid = id.toHexString();
        const u = await this.usersService.findById(uid);
        participants.push({
          id: uid,
          displayName: u?.displayName?.trim() || u?.username || 'User',
          avatarUrl: u?.profileImageUrl ?? undefined,
          online: this.presenceService.isOnline(uid),
        });
      }

      return {
        id: convo._id.toHexString(),
        type: convo.type,
        participantIds: convo.participantIds.map((id) => id.toHexString()),
        participants,
        name: convo.name ?? MODERATOR_DISPLAY_NAME,
        lastMessageText: convo.lastMessageText,
        lastMessageAt: convo.lastMessageAt,
        unreadCount: convo.unreadCounts?.[viewerId] ?? 0,
        createdAt: (convo as ConversationDocument & { createdAt: Date })
          .createdAt,
      };
    }

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

  private async messageToGql(
    msg: MessageDocument,
    viewerId?: string,
    includeAdminMeta = false,
  ): Promise<MessageGql> {
    if (msg.isModeratorMessage) {
      const gql: MessageGql = {
        id: msg._id.toHexString(),
        conversationId: msg.conversationId.toHexString(),
        senderId: MODERATOR_SENDER_GQL_ID,
        senderName: MODERATOR_DISPLAY_NAME,
        senderAvatar: MODERATOR_AVATAR_URL,
        text: msg.text ?? '',
        imageUrl: msg.imageUrl ?? undefined,
        readBy: msg.readBy.map((r) => ({
          userId: r.userId.toHexString(),
          readAt: r.readAt,
        })),
        createdAt: (msg as MessageDocument & { createdAt: Date }).createdAt,
      };

      if (includeAdminMeta && msg.sentByAdminId) {
        const admin = await this.usersService.findById(
          msg.sentByAdminId.toHexString(),
        );
        gql.sentByAdminId = msg.sentByAdminId.toHexString();
        gql.sentByAdminName =
          admin?.displayName?.trim() || admin?.username || 'Admin';
        gql.sentByAdminEmail = admin?.email ?? '';
      }

      void viewerId;
      return gql;
    }

    const sender = await this.usersService.findById(msg.senderId.toHexString());
    const gql: MessageGql = {
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
      createdAt: (msg as MessageDocument & { createdAt: Date }).createdAt,
    };

    void viewerId;
    return gql;
  }

  private async moderatorMessageAdminGql(
    msg: MessageDocument,
  ): Promise<ModeratorMessageAdminGql> {
    const convo = await this.conversationModel
      .findById(msg.conversationId)
      .exec();
    const recipientId = convo ? this.extractModeratorRecipientId(convo) : null;
    const recipient = recipientId
      ? await this.usersService.findById(recipientId)
      : null;
    const admin = msg.sentByAdminId
      ? await this.usersService.findById(msg.sentByAdminId.toHexString())
      : null;

    return {
      id: msg._id.toHexString(),
      conversationId: msg.conversationId.toHexString(),
      text: msg.text ?? '',
      imageUrl: msg.imageUrl ?? undefined,
      createdAt: (msg as MessageDocument & { createdAt: Date }).createdAt,
      recipientUserId: recipientId ?? '',
      recipientName:
        recipient?.displayName?.trim() || recipient?.username || 'User',
      recipientEmail: recipient?.email ?? '',
      sentByAdminId: msg.sentByAdminId?.toHexString() ?? '',
      sentByAdminName: admin?.displayName?.trim() || admin?.username || 'Admin',
      sentByAdminEmail: admin?.email ?? '',
    };
  }

  private async moderatorThreadAdminGql(
    convo: ConversationDocument,
  ): Promise<ModeratorThreadAdminGql> {
    const recipientId = this.extractModeratorRecipientId(convo) ?? '';
    const recipient = recipientId
      ? await this.usersService.findById(recipientId)
      : null;
    const messageCount = await this.messageModel
      .countDocuments({ conversationId: convo._id })
      .exec();

    return {
      conversationId: convo._id.toHexString(),
      recipientUserId: recipientId,
      recipientName:
        recipient?.displayName?.trim() || recipient?.username || 'User',
      recipientEmail: recipient?.email ?? '',
      recipientProfileImageUrl: recipient?.profileImageUrl ?? undefined,
      lastMessageText: convo.lastMessageText,
      lastMessageAt: convo.lastMessageAt,
      messageCount,
      unreadFromUserCount:
        convo.unreadCounts?.[MODERATOR_ADMIN_UNREAD_KEY] ?? 0,
    };
  }
}
