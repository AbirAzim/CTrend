import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class MessageReactionCountGql {
  @Field()
  emoji: string;

  @Field(() => Int)
  count: number;
}

@ObjectType()
export class MessageReplyPreviewGql {
  @Field(() => ID)
  messageId: string;

  /** Client-facing sender id of the quoted message ('moderator' or user hex). */
  @Field(() => ID)
  senderId: string;

  @Field()
  senderName: string;

  @Field({ defaultValue: '' })
  text: string;

  @Field({ nullable: true })
  imageUrl?: string;
}

@ObjectType()
export class MessageReactionChangedGql {
  @Field(() => ID)
  messageId: string;

  @Field(() => ID)
  conversationId: string;

  @Field(() => [MessageReactionCountGql])
  reactions: MessageReactionCountGql[];

  /** User who added/changed/removed their reaction. */
  @Field(() => ID)
  actorUserId: string;

  @Field(() => String, { nullable: true })
  actorEmoji?: string | null;
}

@ObjectType()
export class ReadReceiptGql {
  @Field(() => ID)
  userId: string;

  @Field()
  readAt: Date;
}

@ObjectType()
export class MessageGql {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  conversationId: string;

  @Field(() => ID)
  senderId: string;

  @Field()
  senderName: string;

  @Field({ nullable: true })
  senderAvatar?: string;

  /** Populated only for admin moderator-thread queries. */
  @Field({ nullable: true })
  sentByAdminId?: string;

  @Field({ nullable: true })
  sentByAdminName?: string;

  @Field({ nullable: true })
  sentByAdminEmail?: string;

  @Field({ defaultValue: '' })
  text: string;

  /** Public URL of an attached image, if any. */
  @Field({ nullable: true })
  imageUrl?: string;

  @Field(() => [ReadReceiptGql])
  readBy: ReadReceiptGql[];

  @Field(() => [MessageReactionCountGql], { defaultValue: [] })
  reactions: MessageReactionCountGql[];

  @Field(() => String, { nullable: true })
  viewerReaction?: string;

  /** Quoted message snapshot when this message is a reply. */
  @Field(() => MessageReplyPreviewGql, { nullable: true })
  replyTo?: MessageReplyPreviewGql;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class ConversationGql {
  @Field(() => ID)
  id: string;

  @Field()
  type: string;

  @Field(() => [ID])
  participantIds: string[];

  @Field(() => [ParticipantGql])
  participants: ParticipantGql[];

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  lastMessageText?: string;

  @Field({ nullable: true })
  lastMessageAt?: Date;

  @Field(() => Int)
  unreadCount: number;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class ParticipantGql {
  @Field(() => ID)
  id: string;

  @Field()
  displayName: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field()
  online: boolean;
}

@ObjectType()
export class MessageReadGql {
  @Field(() => ID)
  conversationId: string;

  /** The user who marked the conversation as read. */
  @Field(() => ID)
  userId: string;

  @Field()
  readAt: Date;
}

@ObjectType()
export class TypingIndicatorGql {
  @Field(() => ID)
  conversationId: string;

  @Field(() => ID)
  userId: string;

  @Field()
  isTyping: boolean;
}

@ObjectType()
export class PresenceChangedGql {
  @Field(() => ID)
  userId: string;

  @Field()
  online: boolean;
}

@ObjectType()
export class ModeratorMessageAdminGql {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  conversationId: string;

  @Field()
  text: string;

  @Field({ nullable: true })
  imageUrl?: string;

  @Field()
  createdAt: Date;

  @Field(() => ID)
  recipientUserId: string;

  @Field()
  recipientName: string;

  @Field()
  recipientEmail: string;

  @Field(() => ID)
  sentByAdminId: string;

  @Field()
  sentByAdminName: string;

  @Field()
  sentByAdminEmail: string;
}

@ObjectType()
export class ModeratorThreadAdminGql {
  @Field(() => ID)
  conversationId: string;

  @Field(() => ID)
  recipientUserId: string;

  @Field()
  recipientName: string;

  @Field()
  recipientEmail: string;

  @Field({ nullable: true })
  recipientProfileImageUrl?: string;

  @Field({ nullable: true })
  lastMessageText?: string;

  @Field({ nullable: true })
  lastMessageAt?: Date;

  @Field(() => Int)
  messageCount: number;

  /** Unread user replies waiting for admin attention. */
  @Field(() => Int)
  unreadFromUserCount: number;
}

@ObjectType()
export class AdminModeratorUserMessageGql {
  @Field(() => ID)
  conversationId: string;

  @Field(() => ID)
  recipientUserId: string;

  @Field(() => MessageGql)
  message: MessageGql;

  @Field(() => Int)
  unreadFromUserCount: number;

  @Field({ nullable: true })
  lastMessageText?: string;

  @Field({ nullable: true })
  lastMessageAt?: Date;
}
