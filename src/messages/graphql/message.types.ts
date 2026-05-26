import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

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

  @Field()
  text: string;

  @Field(() => [ReadReceiptGql])
  readBy: ReadReceiptGql[];

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
