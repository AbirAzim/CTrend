import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './notification.schema';
import {
  NotificationGql,
  NotificationsPageGql,
} from './graphql/notification.types';
import { pubsub, NEW_NOTIFICATION } from '../pubsub';
import { UsersService } from '../users/users.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    private usersService: UsersService,
  ) {}

  async create(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    referenceId?: string;
    referenceType?: string;
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
    return gql;
  }

  /**
   * For grouped notifications (POST_HYPE, POST_COMMENT): find an existing
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
    actorId: string;
    actorName: string;
    /** "{name} hyped your post" -> verbPhrase = "hyped your post" */
    verbPhrase: string;
    title: string;
  }): Promise<NotificationGql | null> {
    // Don't notify yourself
    if (params.userId === params.actorId) return null;

    const existing = await this.notificationModel
      .findOne({
        userId: new Types.ObjectId(params.userId),
        type: params.type,
        referenceId: params.referenceId,
        read: false,
      })
      .exec();

    if (existing) {
      // Same actor as last time → no-op (prevents bouncing on like/unlike/like)
      if (existing.latestActorId === params.actorId) {
        return this.toGql(existing);
      }
      existing.actorCount += 1;
      existing.latestActorId = params.actorId;
      existing.latestActorName = params.actorName;
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
      return gql;
    }

    return this.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: this.formatGroupedBody(params.actorName, 1, params.verbPhrase),
      referenceId: params.referenceId,
      referenceType: params.referenceType,
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

  async myNotifications(
    userId: string,
    skip = 0,
    take = 20,
  ): Promise<NotificationsPageGql> {
    const userOid = new Types.ObjectId(userId);
    const [items, totalCount, unreadCount] = await Promise.all([
      this.notificationModel
        .find({ userId: userOid })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .exec(),
      this.notificationModel.countDocuments({ userId: userOid }),
      this.notificationModel.countDocuments({ userId: userOid, read: false }),
    ]);
    return { items: items.map((n) => this.toGql(n)), totalCount, unreadCount };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
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
    await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), read: false },
      { $set: { read: true } },
    );
    return true;
  }

  private toGql(doc: NotificationDocument): NotificationGql {
    return {
      id: doc._id.toHexString(),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      referenceId: doc.referenceId,
      referenceType: doc.referenceType,
      actorCount: doc.actorCount ?? 1,
      latestActorId: doc.latestActorId,
      latestActorName: doc.latestActorName,
      read: doc.read,
      createdAt: (doc as any).createdAt,
    };
  }
}
