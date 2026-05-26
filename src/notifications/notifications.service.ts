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
  }): Promise<NotificationGql> {
    const doc = await this.notificationModel.create({
      userId: new Types.ObjectId(params.userId),
      type: params.type,
      title: params.title,
      body: params.body,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      read: false,
    });
    const gql = this.toGql(doc);
    await pubsub.publish(NEW_NOTIFICATION, {
      newNotification: gql,
      recipientId: params.userId,
    });
    return gql;
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
      read: doc.read,
      createdAt: (doc as any).createdAt,
    };
  }
}
