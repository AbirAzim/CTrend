import {
  Args,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
  Subscription,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { MessagesService } from './messages.service';
import {
  ConversationGql,
  MessageGql,
  ModeratorMessageAdminGql,
  ModeratorThreadAdminGql,
  AdminModeratorUserMessageGql,
  MessageReadGql,
  MessageReactionChangedGql,
  PresenceChangedGql,
  TypingIndicatorGql,
} from './graphql/message.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  pubsub,
  NEW_MESSAGE,
  ADMIN_MODERATOR_USER_MESSAGE,
  MESSAGE_READ,
  MESSAGE_REACTION_CHANGED,
  MESSAGE_DELETED,
  TYPING_INDICATOR,
  USER_PRESENCE_CHANGED,
} from '../pubsub';
import { PresenceService } from '../presence/presence.service';

type ReqUser = { id: string; role: string };

@Resolver()
export class MessagesResolver {
  constructor(
    private messagesService: MessagesService,
    private presenceService: PresenceService,
  ) {}

  // ── Queries ────────────────────────────────────────────────────

  @Query(() => [ConversationGql])
  @UseGuards(GqlAuthGuard)
  async myConversations(@CurrentUser() user: ReqUser) {
    return this.messagesService.myConversations(user.id);
  }

  @Query(() => [MessageGql])
  @UseGuards(GqlAuthGuard)
  async messages(
    @CurrentUser() user: ReqUser,
    @Args('conversationId', { type: () => ID }) conversationId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 30 }) take: number,
  ) {
    return this.messagesService.getMessages(
      user.id,
      conversationId,
      skip,
      take,
    );
  }

  @Query(() => [String])
  @UseGuards(GqlAuthGuard)
  async onlineUserIds(): Promise<string[]> {
    return this.presenceService.onlineUserIds();
  }

  @Query(() => [ModeratorMessageAdminGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminModeratorMessages(
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 50 }) take: number,
    @Args('search', { nullable: true }) search?: string,
  ) {
    return this.messagesService.listModeratorMessagesForAdmin(
      skip,
      take,
      search,
    );
  }

  @Query(() => Int)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminModeratorMessagesCount(
    @Args('search', { nullable: true }) search?: string,
  ) {
    return this.messagesService.countModeratorMessagesForAdmin(search);
  }

  @Query(() => [ModeratorThreadAdminGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminModeratorThreads(
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 50 }) take: number,
    @Args('search', { nullable: true }) search?: string,
  ) {
    return this.messagesService.listModeratorThreadsForAdmin(
      skip,
      take,
      search,
    );
  }

  @Query(() => [MessageGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminModeratorThreadMessages(
    @Args('userId', { type: () => ID }) userId: string,
  ) {
    return this.messagesService.getModeratorThreadMessagesForAdmin(userId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async markModeratorThreadReadForAdmin(
    @Args('userId', { type: () => ID }) userId: string,
  ) {
    return this.messagesService.markModeratorThreadReadForAdmin(userId);
  }

  // ── Mutations ──────────────────────────────────────────────────

  @Mutation(() => ConversationGql)
  @UseGuards(GqlAuthGuard)
  async startDirectConversation(
    @CurrentUser() user: ReqUser,
    @Args('userId', { type: () => ID }) userId: string,
  ) {
    const convo = await this.messagesService.getOrCreateDirect(
      user.id,
      userId,
      user.role,
    );
    return this.messagesService.conversationToGql(convo, user.id);
  }

  @Mutation(() => ConversationGql)
  @UseGuards(GqlAuthGuard)
  async createGroupConversation(
    @CurrentUser() user: ReqUser,
    @Args('memberIds', { type: () => [ID] }) memberIds: string[],
    @Args('name') name: string,
  ) {
    const convo = await this.messagesService.createGroup(
      user.id,
      memberIds,
      name,
    );
    return this.messagesService.conversationToGql(convo, user.id);
  }

  @Mutation(() => MessageGql)
  @UseGuards(GqlAuthGuard)
  async sendMessage(
    @CurrentUser() user: ReqUser,
    @Args('conversationId', { type: () => ID }) conversationId: string,
    @Args('text', { defaultValue: '' }) text: string,
    @Args('imageUrl', { nullable: true }) imageUrl?: string,
    @Args('replyToId', { type: () => ID, nullable: true }) replyToId?: string,
  ) {
    return this.messagesService.sendMessage(
      user.id,
      conversationId,
      text,
      imageUrl,
      replyToId,
    );
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async markConversationRead(
    @CurrentUser() user: ReqUser,
    @Args('conversationId', { type: () => ID }) conversationId: string,
  ) {
    return this.messagesService.markRead(user.id, conversationId);
  }

  @Mutation(() => MessageGql)
  @UseGuards(GqlAuthGuard)
  async reactMessage(
    @CurrentUser() user: ReqUser,
    @Args('messageId', { type: () => ID }) messageId: string,
    @Args('emoji', { type: () => String, nullable: true }) emoji: string | null,
  ) {
    return this.messagesService.reactMessage(user.id, messageId, emoji);
  }

  @Mutation(() => MessageGql)
  @UseGuards(GqlAuthGuard)
  async deleteMessage(
    @CurrentUser() user: ReqUser,
    @Args('messageId', { type: () => ID }) messageId: string,
  ) {
    return this.messagesService.deleteMessage(user.id, messageId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async setTyping(
    @CurrentUser() user: ReqUser,
    @Args('conversationId', { type: () => ID }) conversationId: string,
    @Args('isTyping') isTyping: boolean,
  ) {
    return this.messagesService.setTyping(user.id, conversationId, isTyping);
  }

  @Mutation(() => ModeratorMessageAdminGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendModeratorMessage(
    @CurrentUser() user: ReqUser,
    @Args('userId', { type: () => ID }) userId: string,
    @Args('text', { defaultValue: '' }) text: string,
    @Args('imageUrl', { nullable: true }) imageUrl?: string,
    @Args('replyToId', { type: () => ID, nullable: true }) replyToId?: string,
  ) {
    return this.messagesService.sendModeratorMessage(
      user.id,
      userId,
      text,
      imageUrl,
      replyToId,
    );
  }

  @Mutation(() => [ModeratorMessageAdminGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendModeratorMessages(
    @CurrentUser() user: ReqUser,
    @Args('userIds', { type: () => [ID] }) userIds: string[],
    @Args('text', { defaultValue: '' }) text: string,
    @Args('imageUrl', { nullable: true }) imageUrl?: string,
    @Args('replyToId', { type: () => ID, nullable: true }) replyToId?: string,
  ) {
    return this.messagesService.sendModeratorMessages(
      user.id,
      userIds,
      text,
      imageUrl,
      replyToId,
    );
  }

  // ── Subscriptions ──────────────────────────────────────────────

  @Subscription(() => MessageGql, {
    filter(payload, _variables, context) {
      const userId: string = context?.req?.user?.id;
      return (
        userId &&
        Array.isArray(payload.participantIds) &&
        payload.participantIds.includes(userId)
      );
    },
    resolve: (payload) => payload.newMessage,
  })
  @UseGuards(GqlAuthGuard)
  messageReceived() {
    return pubsub.asyncIterableIterator(NEW_MESSAGE);
  }

  @Subscription(() => AdminModeratorUserMessageGql, {
    resolve: (payload) => payload.adminModeratorUserMessage,
  })
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  adminModeratorUserMessage() {
    return pubsub.asyncIterableIterator(ADMIN_MODERATOR_USER_MESSAGE);
  }

  /**
   * Fires when any participant marks a conversation as read.
   * Only delivered to users who are participants in that conversation.
   */
  @Subscription(() => MessageReadGql, {
    filter(payload, _variables, context) {
      const userId: string = context?.req?.user?.id;
      return (
        userId &&
        Array.isArray(payload.participantIds) &&
        payload.participantIds.includes(userId)
      );
    },
    resolve: (payload) => payload.messageRead,
  })
  @UseGuards(GqlAuthGuard)
  messageRead() {
    return pubsub.asyncIterableIterator(MESSAGE_READ);
  }

  @Subscription(() => MessageReactionChangedGql, {
    filter(payload, _variables, context) {
      const userId: string = context?.req?.user?.id;
      return (
        userId &&
        Array.isArray(payload.participantIds) &&
        payload.participantIds.includes(userId)
      );
    },
    resolve: (payload) => payload.messageReactionChanged,
  })
  @UseGuards(GqlAuthGuard)
  messageReactionChanged() {
    return pubsub.asyncIterableIterator(MESSAGE_REACTION_CHANGED);
  }

  @Subscription(() => MessageGql, {
    filter(payload, _variables, context) {
      const userId: string = context?.req?.user?.id;
      return (
        userId &&
        Array.isArray(payload.participantIds) &&
        payload.participantIds.includes(userId)
      );
    },
    resolve: (payload) => payload.messageDeleted,
  })
  @UseGuards(GqlAuthGuard)
  messageDeleted() {
    return pubsub.asyncIterableIterator(MESSAGE_DELETED);
  }

  @Subscription(() => TypingIndicatorGql, {
    filter: (payload, variables) =>
      payload.typingIndicator.conversationId === variables.conversationId,
    resolve: (payload) => payload.typingIndicator,
  })
  @UseGuards(GqlAuthGuard)
  typingIndicator(
    @Args('conversationId', { type: () => ID }) conversationId: string,
  ) {
    void conversationId;
    return pubsub.asyncIterableIterator(TYPING_INDICATOR);
  }

  @Subscription(() => PresenceChangedGql, {
    resolve: (payload) => payload.presenceChanged,
  })
  @UseGuards(GqlAuthGuard)
  presenceChanged() {
    return pubsub.asyncIterableIterator(USER_PRESENCE_CHANGED);
  }
}
