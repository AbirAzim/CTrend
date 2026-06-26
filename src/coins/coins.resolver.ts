import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CoinsService } from './coins.service';
import {
  CoinHistoryItemGql,
  CoinLeaderboardEntryGql,
  DailyStreakGql,
} from './graphql/coin.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { OptionalJwtGqlGuard } from '../common/guards/optional-jwt-gql.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';

type ReqUser = { id: string; role: string };

@Resolver()
export class CoinsResolver {
  constructor(
    private readonly coins: CoinsService,
    private readonly usersService: UsersService,
  ) {}

  /** Viewer's own coin balance. */
  @Query(() => Int)
  @UseGuards(GqlAuthGuard)
  async myCoins(@CurrentUser() user: ReqUser): Promise<number> {
    return this.coins.getBalance(user.id);
  }

  /** Referral / invite points earned (public on profiles). */
  @Query(() => Int)
  @UseGuards(OptionalJwtGqlGuard)
  async referralPoints(
    @Args('userId', { type: () => ID }) userId: string,
  ): Promise<number> {
    return this.coins.getReferralPoints(userId);
  }

  /** Referral-point history (INVITE + REFERRAL_INVITEE ledger entries). */
  @Query(() => [CoinHistoryItemGql])
  @UseGuards(OptionalJwtGqlGuard)
  async referralPointsHistory(
    @CurrentUser() viewer: ReqUser | undefined,
    @Args('userId', { type: () => ID, nullable: true }) userId?: string | null,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ): Promise<CoinHistoryItemGql[]> {
    const targetId = userId ?? viewer?.id;
    if (!targetId) return [];
    const rows = await this.coins.getReferralPointsHistory(
      targetId,
      skip ?? 0,
      take ?? 30,
    );
    return rows.map((r) => ({
      id: r._id.toHexString(),
      type: r.type,
      amount: r.amount,
      createdAt: r.createdAt ?? new Date(),
    }));
  }

  /** Public coin history for any user (shown on profiles). When `userId` is
   * omitted, returns the viewer's own history. */
  @Query(() => [CoinHistoryItemGql])
  @UseGuards(OptionalJwtGqlGuard)
  async coinHistory(
    @CurrentUser() viewer: ReqUser | undefined,
    @Args('userId', { type: () => ID, nullable: true }) userId?: string | null,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ): Promise<CoinHistoryItemGql[]> {
    const targetId = userId ?? viewer?.id;
    if (!targetId) return [];
    const rows = await this.coins.getHistory(targetId, skip ?? 0, take ?? 30);
    return rows.map((r) => ({
      id: r._id.toHexString(),
      type: r.type,
      amount: r.amount,
      createdAt: r.createdAt ?? new Date(),
    }));
  }

  /** All-time top coin earners. */
  @Query(() => [CoinLeaderboardEntryGql])
  async coinLeaderboard(
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ): Promise<CoinLeaderboardEntryGql[]> {
    const users = await this.coins.getLeaderboard(take ?? 50);
    return users.map((u, i) => ({
      rank: i + 1,
      coins: u.coins ?? 0,
      user: this.usersService.toGql(u),
    }));
  }

  /** Claim the once-per-day streak bonus (called on app open / login). */
  @Mutation(() => DailyStreakGql)
  @UseGuards(GqlAuthGuard)
  async claimDailyCoins(@CurrentUser() user: ReqUser): Promise<DailyStreakGql> {
    return this.coins.claimDailyStreak(user.id);
  }
}
