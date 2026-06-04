import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './conversation.schema';
import { Message, MessageDocument, ReplyPreview } from './message.schema';
import {
  MessageReaction,
  MessageReactionDocument,
} from './message-reaction.schema';
import {
  isMessageReactionEmoji,
  MESSAGE_REACTION_EMOJIS,
} from './message-reaction.constants';
import { UsersService } from '../users/users.service';
import { FollowsService } from '../follows/follows.service';
import { PresenceService } from '../presence/presence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../push/push.service';
import {
  ConversationGql,
  MessageGql,
  MessageReactionCountGql,
  MessageReactionChangedGql,
  MessageReplyPreviewGql,
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
  MESSAGE_REACTION_CHANGED,
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
    @InjectModel(MessageReaction.name)
    private messageReactionModel: Model<MessageReactionDocument>,
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
    replyToId?: string | null,
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

    const replyTo = await this.buildReplySnapshot(convo._id, replyToId);

    const msg = await this.messageModel.create({
      conversationId: convo._id,
      senderId: moderatorSenderOid,
      sentByAdminId: new Types.ObjectId(adminId),
      isModeratorMessage: true,
      text: trimmedText,
      imageUrl: imageUrl ?? null,
      readBy: [],
      replyTo,
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
    replyToId?: string | null,
  ): Promise<ModeratorMessageAdminGql[]> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    // A quoted reply only makes sense within a single thread — ignore it for
    // multi-recipient broadcasts so we never quote a message into a stranger's
    // conversation.
    const effectiveReplyToId = unique.length === 1 ? replyToId : null;
    const results: ModeratorMessageAdminGql[] = [];
    for (const userId of unique) {
      results.push(
        await this.sendModeratorMessage(
          adminId,
          userId,
          text,
          imageUrl,
          effectiveReplyToId,
        ),
      );
    }
    return results;
  }

  /**
   * System-generated moderator auto-reply (no specific admin actor).
   * Used for automated operational flows (e.g. prize-claim acknowledgement).
   */
  async sendSystemModeratorAutoMessage(
    targetUserId: string,
    text: string,
  ): Promise<void> {
    const trimmedText = text?.trim() ?? '';
    if (!trimmedText) return;
    const target = await this.usersService.findById(targetUserId);
    if (!target) throw new NotFoundException('User not found');

    const targetOid = this.requireUserObjectId(targetUserId);
    const existing = await this.conversationModel
      .findOne({
        type: 'moderator',
        participantIds: targetOid,
      })
      .exec();

    const convo =
      existing ??
      (await this.conversationModel.create({
        type: 'moderator',
        participantIds: [targetOid],
        name: MODERATOR_DISPLAY_NAME,
        // System-generated thread bootstrap; no specific admin owner.
        createdBy: targetOid,
        unreadCounts: {},
      }));

    const msg = await this.messageModel.create({
      conversationId: convo._id,
      senderId: new Types.ObjectId(MODERATOR_SENDER_OBJECT_ID),
      isModeratorMessage: true,
      text: trimmedText,
      imageUrl: null,
      readBy: [],
    });

    await this.conversationModel.updateOne(
      { _id: convo._id },
      {
        $set: {
          lastMessageText: trimmedText.slice(0, 100),
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
      body: trimmedText.slice(0, 140),
      referenceId: convo._id.toHexString(),
      referenceType: 'moderator_conversation',
    });
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

    return this.messagesToGql(msgs, resolvedUserId, true);
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
    replyToId?: string | null,
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

    const replyTo = await this.buildReplySnapshot(convo._id, replyToId);

    const msg = await this.messageModel.create({
      conversationId: convo._id,
      senderId: viewerOid,
      text: trimmedText,
      imageUrl: imageUrl ?? null,
      readBy: [{ userId: viewerOid, readAt: new Date() }],
      replyTo,
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
          notifType: 'MESSAGE',
          // Data-only: the app's native FirebaseMessagingService renders the
          // sender's round avatar + name + message text and deep-links on tap.
          title: gql.senderName ?? '',
          body: gql.text ?? '',
          actorAvatar: gql.senderAvatar ?? '',
          referenceType: 'Conversation',
          referenceId: convo._id.toHexString(),
          postId: '',
          commentId: '',
          conversationId: convo._id.toHexString(),
          senderName: gql.senderName ?? '',
          senderAvatar: gql.senderAvatar ?? '',
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

    return this.messagesToGql(msgs.reverse(), viewerId);
  }

  async reactMessage(
    viewerId: string,
    messageId: string,
    emoji: string | null,
  ): Promise<MessageGql> {
    const msg = await this.messageModel.findById(messageId).exec();
    if (!msg) throw new NotFoundException('Message not found');

    const convo = await this.conversationModel
      .findById(msg.conversationId)
      .exec();
    if (!convo) throw new NotFoundException('Conversation not found');

    const viewerOid = new Types.ObjectId(viewerId);
    if (!convo.participantIds.some((id) => id.equals(viewerOid))) {
      throw new ForbiddenException('Not a participant');
    }

    const mid = msg._id;
    let actorEmoji: string | null = null;

    if (emoji === null || emoji === '') {
      await this.messageReactionModel.deleteOne({
        messageId: mid,
        userId: viewerOid,
      });
    } else {
      if (!isMessageReactionEmoji(emoji)) {
        throw new BadRequestException('Invalid reaction emoji');
      }
      await this.messageReactionModel.updateOne(
        { messageId: mid, userId: viewerOid },
        { $set: { emoji } },
        { upsert: true },
      );
      actorEmoji = emoji;
    }

    const reactions = await this.reactionCountsForMessage(mid);
    const gql = await this.messagesToGql([msg], viewerId);
    const payload: MessageReactionChangedGql = {
      messageId: mid.toHexString(),
      conversationId: msg.conversationId.toHexString(),
      reactions,
      actorUserId: viewerId,
      actorEmoji,
    };

    await pubsub.publish(MESSAGE_REACTION_CHANGED, {
      messageReactionChanged: payload,
      participantIds: convo.participantIds.map((id) => id.toHexString()),
    });

    return gql[0];
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

  // ── Message reactions ─────────────────────────────────────────

  private sortReactionCounts(
    reactions: MessageReactionCountGql[],
  ): MessageReactionCountGql[] {
    const order = new Map(MESSAGE_REACTION_EMOJIS.map((e, i) => [e, i]));
    return [...reactions].sort(
      (a, b) =>
        (order.get(a.emoji as (typeof MESSAGE_REACTION_EMOJIS)[number]) ?? 99) -
        (order.get(b.emoji as (typeof MESSAGE_REACTION_EMOJIS)[number]) ?? 99),
    );
  }

  private async reactionCountsForMessage(
    messageId: Types.ObjectId,
  ): Promise<MessageReactionCountGql[]> {
    const map = await this.batchReactionCountsMap([messageId]);
    return map.get(messageId.toHexString()) ?? [];
  }

  private async batchReactionCountsMap(
    messageIds: Types.ObjectId[],
  ): Promise<Map<string, MessageReactionCountGql[]>> {
    if (messageIds.length === 0) return new Map();

    const rows = await this.messageReactionModel
      .aggregate<{
        messageId: Types.ObjectId;
        emoji: string;
        count: number;
      }>([
        { $match: { messageId: { $in: messageIds } } },
        {
          $group: {
            _id: { messageId: '$messageId', emoji: '$emoji' },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            messageId: '$_id.messageId',
            emoji: '$_id.emoji',
            count: 1,
          },
        },
      ])
      .exec();

    const map = new Map<string, MessageReactionCountGql[]>();
    for (const row of rows) {
      const key = row.messageId.toHexString();
      const list = map.get(key) ?? [];
      list.push({ emoji: row.emoji, count: row.count });
      map.set(key, list);
    }
    for (const [key, list] of map) {
      map.set(key, this.sortReactionCounts(list));
    }
    return map;
  }

  private async batchViewerReactionsMap(
    messageIds: Types.ObjectId[],
    viewerId: string,
  ): Promise<Map<string, string>> {
    if (messageIds.length === 0) return new Map();
    const rows = await this.messageReactionModel
      .find({
        messageId: { $in: messageIds },
        userId: new Types.ObjectId(viewerId),
      })
      .select({ messageId: 1, emoji: 1 })
      .lean()
      .exec();
    return new Map(rows.map((r) => [r.messageId.toHexString(), r.emoji]));
  }

  private async messagesToGql(
    msgs: MessageDocument[],
    viewerId: string,
    includeAdminMeta = false,
  ): Promise<MessageGql[]> {
    if (msgs.length === 0) return [];
    const ids = msgs.map((m) => m._id);
    const countsMap = await this.batchReactionCountsMap(ids);
    const viewerMap = await this.batchViewerReactionsMap(ids, viewerId);
    return Promise.all(
      msgs.map((m) =>
        this.messageToGql(m, viewerId, includeAdminMeta, countsMap, viewerMap),
      ),
    );
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

  /**
   * Resolve a reply target into a denormalised snapshot stored on the new
   * message. Returns null when no (valid) reply target is given.
   */
  private async buildReplySnapshot(
    convoId: Types.ObjectId,
    replyToId?: string | null,
  ): Promise<ReplyPreview | null> {
    const trimmed = replyToId?.trim();
    if (!trimmed || !Types.ObjectId.isValid(trimmed)) return null;

    const parent = await this.messageModel.findById(trimmed).exec();
    if (!parent) throw new NotFoundException('Replied-to message not found');
    if (!parent.conversationId.equals(convoId)) {
      throw new BadRequestException(
        'Cannot reply to a message from another conversation',
      );
    }

    let senderId: string;
    let senderName: string;
    if (parent.isModeratorMessage) {
      senderId = MODERATOR_SENDER_GQL_ID;
      senderName = MODERATOR_DISPLAY_NAME;
    } else {
      senderId = parent.senderId.toHexString();
      const sender = await this.usersService.findById(senderId);
      senderName = sender?.displayName?.trim() || sender?.username || 'User';
    }

    return {
      messageId: parent._id,
      senderId,
      senderName,
      text: (parent.text ?? '').slice(0, 140),
      imageUrl: parent.imageUrl ?? null,
    };
  }

  private replyPreviewToGql(
    rp?: ReplyPreview | null,
  ): MessageReplyPreviewGql | undefined {
    if (!rp) return undefined;
    return {
      messageId: String(rp.messageId),
      senderId: rp.senderId,
      senderName: rp.senderName,
      text: rp.text ?? '',
      imageUrl: rp.imageUrl ?? undefined,
    };
  }

  private async messageToGql(
    msg: MessageDocument,
    viewerId?: string,
    includeAdminMeta = false,
    countsMap?: Map<string, MessageReactionCountGql[]>,
    viewerMap?: Map<string, string>,
  ): Promise<MessageGql> {
    const msgId = msg._id.toHexString();
    const reactions =
      countsMap?.get(msgId) ?? (await this.reactionCountsForMessage(msg._id));
    const viewerReaction =
      viewerId && viewerMap
        ? viewerMap.get(msgId)
        : viewerId
          ? (
              await this.messageReactionModel
                .findOne({
                  messageId: msg._id,
                  userId: new Types.ObjectId(viewerId),
                })
                .lean()
                .exec()
            )?.emoji
          : undefined;

    if (msg.isModeratorMessage) {
      const gql: MessageGql = {
        id: msgId,
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
        reactions,
        viewerReaction: viewerReaction ?? undefined,
        replyTo: this.replyPreviewToGql(msg.replyTo),
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
      id: msgId,
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
      reactions,
      viewerReaction: viewerReaction ?? undefined,
      replyTo: this.replyPreviewToGql(msg.replyTo),
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
