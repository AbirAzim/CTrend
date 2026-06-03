import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './notification.schema';
import { Follow, FollowDocument, FollowStatus } from '../follows/follow.schema';
import {
  NotificationGql,
  NotificationsPageGql,
} from './graphql/notification.types';
import { pubsub, NEW_NOTIFICATION } from '../pubsub';
import { UsersService } from '../users/users.service';
import { PushService } from '../push/push.service';
import { PLATFORM_BRAND_NAME } from '../common/platform-brand';

const PLATFORM_NOTIFY_BATCH = 250;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    @InjectModel(Follow.name)
    private followModel: Model<FollowDocument>,
    private usersService: UsersService,
    private pushService: PushService,
  ) {}

  async create(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    referenceId?: string;
    referenceType?: string;
    postId?: string;
    commentId?: string;
    actorId?: string;
    actorName?: string;
  }): Promise<NotificationGql> {
    const doc = await this.notificationModel.create({
      userId: new Types.ObjectId(params.userId),
      type: params.type,
      title: params.title,
      body: params.body,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      postId: params.postId,
      commentId: params.commentId,
      actorCount: 1,
      latestActorId: params.actorId,
      latestActorName: params.actorName,
      read: false,
    });
    const gql = this.toGql(doc);
    await pubsub.publish(NEW_NOTIFICATION, {
      newNotification: gql,
      recipientId: params.userId,
    });
    await this.sendBellPush(params.userId, gql);
    return gql;
  }

  /**
   * For grouped notifications (POST_HYPE, POST_VOTE, POST_COMMENT): find an existing
   * UNREAD notification for the same recipient+type+referenceId. If found,
   * increment actorCount, update latestActor*, refresh title/body, and bump
   * createdAt. If not found, create a new one. Skips no-op when the same
   * actor triggers the same event back-to-back (e.g. like → unlike → like).
   */
  async createOrUpdateGrouped(params: {
    userId: string;
    type: NotificationType;
    referenceId: string;
    referenceType: string;
    postId?: string;
    commentId?: string;
    /** Omitted for anonymous actions (e.g. anonymous vote) — no avatar/profile link. */
    actorId?: string;
    actorName: string;
    /** "{name} hyped your post" -> verbPhrase = "hyped your post" */
    verbPhrase: string;
    title: string;
  }): Promise<NotificationGql | null> {
    // Don't notify yourself (identified actors only)
    if (params.actorId && params.userId === params.actorId) return null;

    const existing = await this.notificationModel
      .findOne({
        userId: new Types.ObjectId(params.userId),
        type: params.type,
        referenceId: params.referenceId,
        read: false,
        archived: { $ne: true },
      })
      .exec();

    if (existing) {
      const isCommentActivity =
        params.type === 'POST_COMMENT' || params.type === 'COMMENT_REPLY';
      // Same actor re-hyping after unhype: bump timestamp and re-notify.
      // Comment types always bump (new comment/reply). Others no-op on duplicate actor.
      const sameIdentifiedActor =
        params.actorId != null && existing.latestActorId === params.actorId;
      if (
        sameIdentifiedActor &&
        params.type !== 'POST_HYPE' &&
        params.type !== 'POST_VOTE' &&
        params.type !== 'COMMENT_REACTION' &&
        !isCommentActivity
      ) {
        return this.toGql(existing);
      }
      const distinctActor =
        params.actorId != null
          ? existing.latestActorId !== params.actorId
          : true;
      if (distinctActor) {
        existing.actorCount += 1;
      }
      if (params.actorId) {
        existing.latestActorId = params.actorId;
      } else {
        existing.latestActorId = undefined;
      }
      existing.latestActorName = params.actorName;
      if (params.postId) existing.postId = params.postId;
      if (params.commentId) existing.commentId = params.commentId;
      existing.read = false;
      existing.body = this.formatGroupedBody(
        params.actorName,
        existing.actorCount,
        params.verbPhrase,
      );
      // Bump timestamp so it sorts to the top
      (existing as any).createdAt = new Date();
      await existing.save();
      const gql = this.toGql(existing);
      await pubsub.publish(NEW_NOTIFICATION, {
        newNotification: gql,
        recipientId: params.userId,
      });
      await this.sendBellPush(params.userId, gql);
      return gql;
    }

    return this.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: this.formatGroupedBody(params.actorName, 1, params.verbPhrase),
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      postId: params.postId,
      commentId: params.commentId,
      actorId: params.actorId,
      actorName: params.actorName,
    });
  }

  private formatGroupedBody(
    latestName: string,
    count: number,
    verbPhrase: string,
  ): string {
    if (count <= 1) return `${latestName} ${verbPhrase}`;
    const others = count - 1;
    return `${latestName} and ${others} more ${verbPhrase}`;
  }

  /**
   * Fan-out in-app + push notifications when a platform-wide (SYSTEM) post goes live.
   * Uses batched insertMany so one failure does not block the rest of the platform.
   */
  async notifyAllUsersOfPlatformPost(params: {
    postId: string;
    authorId: string;
    authorName: string;
    caption?: string;
  }): Promise<number> {
    const allUserIds = await this.usersService.findAllIds();
    const recipients = allUserIds.filter((id) => id !== params.authorId);
    if (!recipients.length) return 0;

    const trimmedCaption = params.caption?.trim() ?? '';
    const body = trimmedCaption
      ? trimmedCaption.slice(0, 120)
      : 'A new platform-wide compare is live — tap to vote.';
    const brandName = params.authorName?.trim() || PLATFORM_BRAND_NAME;
    const title = `📢 ${brandName}`;

    for (let i = 0; i < recipients.length; i += PLATFORM_NOTIFY_BATCH) {
      const chunk = recipients.slice(i, i + PLATFORM_NOTIFY_BATCH);
      const docs = chunk.map((userId) => ({
        userId: new Types.ObjectId(userId),
        type: 'ANNOUNCEMENT' as NotificationType,
        title,
        body,
        referenceId: params.postId,
        referenceType: 'Post',
        postId: params.postId,
        actorCount: 1,
        latestActorName: brandName,
        read: false,
        archived: false,
      }));

      let inserted: NotificationDocument[];
      try {
        inserted = (await this.notificationModel.insertMany(docs, {
          ordered: false,
        })) as NotificationDocument[];
      } catch (err) {
        this.logger.error(
          `Platform post notify batch failed (offset ${i})`,
          err,
        );
        continue;
      }

      await Promise.allSettled(
        inserted.map(async (doc) => {
          const recipientId = doc.userId.toHexString();
          const gql = this.toGql(doc);
          await pubsub.publish(NEW_NOTIFICATION, {
            newNotification: gql,
            recipientId,
          });
          await this.sendBellPush(recipientId, gql);
        }),
      );
    }

    return recipients.length;
  }

  async sendBroadcast(
    adminId: string,
    title: string,
    body: string,
  ): Promise<number> {
    const allIds = await this.usersService.findAllIds();
    const recipients = allIds.filter((id) => id !== adminId);
    await Promise.all(
      recipients.map((userId) =>
        this.create({ userId, type: 'ANNOUNCEMENT', title, body }),
      ),
    );
    return recipients.length;
  }

  /**
   * Mark FRIEND_REQUEST notifications resolved when recipient and requester are
   * already mutual friends (e.g. accepted on profile, not via the bell).
   */
  async reconcileStaleFriendRequestNotifications(
    userId: string,
  ): Promise<void> {
    const userOid = new Types.ObjectId(userId);
    // Match unresolved copy (read flag alone can be stale in older rows).
    const pending = await this.notificationModel
      .find({
        userId: userOid,
        type: 'FRIEND_REQUEST',
        title: 'New friend request',
        archived: { $ne: true },
        referenceId: { $exists: true, $nin: [null, ''] },
      })
      .select('referenceId')
      .lean()
      .exec();

    if (!pending.length) return;

    const refIds = [
      ...new Set(
        pending
          .map((n) => n.referenceId)
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    ];
    if (!refIds.length) return;

    const friendIds = await this.getMutualFriendIdSet(userId);
    const staleRefIds = refIds.filter((id) => friendIds.has(id));
    await Promise.all(
      staleRefIds.map((requesterId) =>
        this.resolveFriendRequestNotifications(
          userId,
          requesterId,
          'already_friends',
        ),
      ),
    );
  }

  private friendRequestResolutionCopy(
    actorName: string,
    outcome: 'accepted' | 'rejected' | 'already_friends' | 'withdrawn',
  ): { title: string; body: string } {
    switch (outcome) {
      case 'accepted':
        return {
          title: 'Friend request accepted',
          body: `You accepted ${actorName}'s friend request`,
        };
      case 'rejected':
        return {
          title: 'Friend request declined',
          body: `You declined ${actorName}'s friend request`,
        };
      case 'already_friends':
        return {
          title: "You're now friends",
          body: `You and ${actorName} are friends`,
        };
      case 'withdrawn':
        return {
          title: 'Friend request withdrawn',
          body: `${actorName} cancelled their friend request`,
        };
    }
  }

  /**
   * Update in-app friend-request rows after accept/decline (any surface) or when
   * friendship already exists. Publishes subscription updates for live UI sync.
   */
  async resolveFriendRequestNotifications(
    recipientUserId: string,
    requesterId: string,
    outcome: 'accepted' | 'rejected' | 'already_friends' | 'withdrawn',
  ): Promise<void> {
    const requester = await this.usersService.findById(requesterId);
    const actorName =
      requester?.displayName?.trim() || requester?.username || 'Someone';
    const { title, body } = this.friendRequestResolutionCopy(
      actorName,
      outcome,
    );

    const docs = await this.notificationModel
      .find({
        userId: new Types.ObjectId(recipientUserId),
        type: 'FRIEND_REQUEST',
        referenceId: requesterId,
      })
      .exec();

    for (const doc of docs) {
      doc.title = title;
      doc.body = body;
      doc.read = true;
      await doc.save();
      const gql = this.toGql(doc);
      await pubsub.publish(NEW_NOTIFICATION, {
        newNotification: gql,
        recipientId: recipientUserId,
      });
    }
  }

  private async getMutualFriendIdSet(userId: string): Promise<Set<string>> {
    const uid = new Types.ObjectId(userId);
    const [followingRows, followerRows] = await Promise.all([
      this.followModel
        .find({ followerId: uid, status: FollowStatus.ACCEPTED })
        .select('followingId')
        .lean()
        .exec(),
      this.followModel
        .find({ followingId: uid, status: FollowStatus.ACCEPTED })
        .select('followerId')
        .lean()
        .exec(),
    ]);
    const followerSet = new Set(
      followerRows.map((r) => r.followerId.toString()),
    );
    return new Set(
      followingRows
        .map((r) => r.followingId.toString())
        .filter((id) => followerSet.has(id)),
    );
  }

  private inboxFilter(userOid: Types.ObjectId) {
    return { userId: userOid, archived: { $ne: true } };
  }

  async myNotifications(
    userId: string,
    skip = 0,
    take = 20,
  ): Promise<NotificationsPageGql> {
    await this.reconcileStaleFriendRequestNotifications(userId);
    const userOid = new Types.ObjectId(userId);
    const filter = this.inboxFilter(userOid);
    const [items, totalCount, unreadCount] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .exec(),
      this.notificationModel.countDocuments(filter),
      this.notificationModel.countDocuments({ ...filter, read: false }),
    ]);
    return { items: items.map((n) => this.toGql(n)), totalCount, unreadCount };
  }

  async unreadCount(userId: string): Promise<number> {
    await this.reconcileStaleFriendRequestNotifications(userId);
    const userOid = new Types.ObjectId(userId);
    return this.notificationModel.countDocuments({
      ...this.inboxFilter(userOid),
      read: false,
    });
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    await this.notificationModel.updateOne(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      { $set: { read: true } },
    );
    return true;
  }

  async markAllRead(userId: string): Promise<boolean> {
    const userOid = new Types.ObjectId(userId);
    await this.notificationModel.updateMany(
      { ...this.inboxFilter(userOid), read: false },
      { $set: { read: true } },
    );
    return true;
  }

  async archive(userId: string, notificationId: string): Promise<boolean> {
    await this.notificationModel.updateOne(
      {
        _id: new Types.ObjectId(notificationId),
        userId: new Types.ObjectId(userId),
      },
      { $set: { archived: true, read: true } },
    );
    return true;
  }

  /** Resolve the profile picture URL of a notification's latest actor (null if none). */
  async resolveActorAvatar(
    actorId?: string | null,
    opts?: { type?: NotificationType; latestActorName?: string | null },
  ): Promise<string | null> {
    if (
      opts?.type === 'POST_VOTE' &&
      (!actorId || opts.latestActorName === 'Someone')
    ) {
      return null;
    }
    if (
      opts?.type === 'ANNOUNCEMENT' &&
      opts.latestActorName === PLATFORM_BRAND_NAME
    ) {
      return null;
    }
    if (!actorId) return null;
    const actor = await this.usersService.findById(actorId);
    return actor?.profileImageUrl ?? null;
  }

  /**
   * Send a data-only, high-priority FCM "BELL" push for a freshly created or
   * updated notification. Failures are swallowed inside PushService so they
   * never break the originating action.
   *
   * The payload follows the app-side display contract: the client renders the
   * notification itself (round actor avatar + sender name + action text), so
   * `title` carries the sender display name and `body` carries the action
   * sentence (e.g. "commented on your post"). System/announcement pushes have
   * no actor — `title` and `actorAvatar` are blank so the app shows the brand
   * logo. `notifType` exposes the specific type for deep-link routing, and
   * `commentId` lets comment notifications scroll to the exact comment.
   */
  private async sendBellPush(
    recipientId: string,
    gql: NotificationGql,
  ): Promise<void> {
    const actorAvatar = await this.resolveActorAvatar(gql.latestActorId, {
      type: gql.type as NotificationType,
      latestActorName: gql.latestActorName,
    });

    const isSystem = gql.type === 'ANNOUNCEMENT' || gql.type === 'SYSTEM';
    const senderName = gql.latestActorName?.trim() ?? '';

    // Actor-driven notifications: title = sender, body = action sentence with
    // the leading name stripped (grouped bodies are "{name} <verb>" /
    // "{name} and N more <verb>"). System/announcement: title blank, full body.
    let pushTitle = '';
    let pushBody = gql.body;
    if (!isSystem && senderName) {
      pushTitle = senderName;
      pushBody = gql.body.startsWith(`${senderName} `)
        ? gql.body.slice(senderName.length + 1)
        : gql.body;
    }

    // OS-rendered notification block. Actor-driven: sender name + avatar.
    // System/announcement: the announcement title (or brand) and no image.
    const notifTitle = isSystem
      ? gql.title?.trim() || PLATFORM_BRAND_NAME
      : senderName || gql.title?.trim() || PLATFORM_BRAND_NAME;

    await this.pushService.sendDataToUser(
      recipientId,
      {
        type: 'BELL',
        notifType: gql.type,
        title: pushTitle,
        body: pushBody,
        actorAvatar: actorAvatar ?? '',
        referenceType: gql.referenceType ?? '',
        referenceId: gql.referenceId ?? '',
        postId: gql.postId ?? '',
        commentId: gql.commentId ?? '',
        conversationId: '',
        senderName: '',
        senderAvatar: '',
      },
      {
        title: notifTitle,
        body: pushBody,
        imageUrl: isSystem ? undefined : (actorAvatar ?? undefined),
      },
    );
  }

  private toGql(doc: NotificationDocument): NotificationGql {
    return {
      id: doc._id.toHexString(),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      referenceId: doc.referenceId,
      referenceType: doc.referenceType,
      postId: doc.postId,
      commentId: doc.commentId,
      actorCount: doc.actorCount ?? 1,
      latestActorId: doc.latestActorId,
      latestActorName: doc.latestActorName,
      read: doc.read,
      archived: doc.archived ?? false,
      createdAt: (doc as any).createdAt,
    };
  }
}
