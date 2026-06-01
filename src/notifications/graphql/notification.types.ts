import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class NotificationGql {
  @Field(() => ID)
  id: string;

  @Field()
  type: string;

  @Field()
  title: string;

  @Field()
  body: string;

  @Field({ nullable: true })
  referenceId?: string;

  @Field({ nullable: true })
  referenceType?: string;

  @Field({ nullable: true })
  postId?: string;

  @Field({ nullable: true })
  commentId?: string;

  @Field(() => Int)
  actorCount: number;

  @Field({ nullable: true })
  latestActorId?: string;

  @Field({ nullable: true })
  latestActorName?: string;

  /** Profile picture URL of the latest actor (resolved on demand). */
  @Field({ nullable: true })
  latestActorAvatar?: string;

  @Field()
  read: boolean;

  @Field()
  archived: boolean;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class NotificationsPageGql {
  @Field(() => [NotificationGql])
  items: NotificationGql[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  unreadCount: number;
}
