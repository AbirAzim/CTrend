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
  PresenceChangedGql,
  TypingIndicatorGql,
} from './graphql/message.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  pubsub,
  NEW_MESSAGE,
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
    @Args('text') text: string,
  ) {
    return this.messagesService.sendMessage(user.id, conversationId, text);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async markConversationRead(
    @CurrentUser() user: ReqUser,
    @Args('conversationId', { type: () => ID }) conversationId: string,
  ) {
    return this.messagesService.markRead(user.id, conversationId);
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

  @Subscription(() => TypingIndicatorGql, {
    filter: (payload, variables) =>
      payload.typingIndicator.conversationId === variables.conversationId,
    resolve: (payload) => payload.typingIndicator,
  })
  @UseGuards(GqlAuthGuard)
  typingIndicator(
    @Args('conversationId', { type: () => ID }) _conversationId: string,
  ) {
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
