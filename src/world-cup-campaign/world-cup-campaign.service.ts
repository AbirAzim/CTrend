import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CampaignWinner,
  CampaignWinnerDocument,
} from './campaign-winner.schema';
import { Fixture, FixtureDocument } from '../fixtures/fixture.schema';
import { Campaign, CampaignDocument } from '../campaigns/campaign.schema';
import { Vote, VoteDocument } from '../votes/vote.schema';
import { Post, PostDocument } from '../posts/post.schema';
import {
  MatchPrediction,
  MatchPredictionDocument,
} from '../match-predictions/match-prediction.schema';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.schema';
import {
  CampaignWinnerGql,
  CampaignWinLeaderboardEntryGql,
  UserCampaignWinSummaryGql,
} from './graphql/campaign-winner.types';
import { CoinsService } from '../coins/coins.service';
import { CoinType } from '../coins/coins.constants';
import {
  CAMPAIGN_WINNER_COOLDOWN_MATCHES,
  CAMPAIGN_WINNER_FIRST_TIME_WEIGHT,
  CAMPAIGN_WINNER_REPEAT_MULTI_WEIGHT,
  CAMPAIGN_WINNER_REPEAT_ONCE_WEIGHT,
  campaignPrizeForFixtureStage,
} from './world-cup-campaign.constants';

@Injectable()
export class WorldCupCampaignService implements OnModuleInit {
  private readonly logger = new Logger(WorldCupCampaignService.name);
  private historySynced = false;

  constructor(
    @InjectModel(CampaignWinner.name)
    private campaignWinnerModel: Model<CampaignWinnerDocument>,
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(MatchPrediction.name)
    private matchPredictionModel: Model<MatchPredictionDocument>,
    private usersService: UsersService,
    private notificationsService: NotificationsService,
    private coinsService: CoinsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.repairUnresolvedCampaignWinners();
      await this.ensureCampaignWinnerHistorySynced();
      await this.processPendingCampaignWinners();
    } catch (err) {
      this.logger.warn(
        `Campaign winner history sync on startup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** True once a draw ran or a definitive no-winner note was recorded. */
  private isResolvedCampaignWinner(doc: {
    userId?: Types.ObjectId | null;
    note?: string | null;
  }): boolean {
    if (doc.userId) return true;
    return Boolean(doc.note?.trim());
  }

  /**
   * Remove placeholder rows created by an older history sync that blocked the
   * announce cron from ever calling processMatchResult.
   */
  private async repairUnresolvedCampaignWinners(): Promise<number> {
    const stubs = await this.campaignWinnerModel
      .find({
        $and: [
          { $or: [{ userId: null }, { userId: { $exists: false } }] },
          {
            $or: [
              { note: null },
              { note: '' },
              { note: { $exists: false } },
            ],
          },
        ],
      })
      .exec();

    if (!stubs.length) return 0;

    await this.campaignWinnerModel.deleteMany({
      _id: { $in: stubs.map((s) => s._id) },
    });
    this.logger.warn(
      `Removed ${stubs.length} unresolved campaign-winner stub(s) — will re-draw on next cron tick`,
    );
    return stubs.length;
  }

  /** Process finished matches whose reveal time passed but never got a winner. */
  private async processPendingCampaignWinners(): Promise<number> {
    const now = new Date();
    const ready = await this.fixtureModel
      .find({
        status: 'FINISHED',
        winnerScheduledAt: { $lte: now },
        matchEndedAt: { $ne: null },
        campaignPostId: { $exists: true, $ne: null },
      })
      .exec();

    let processed = 0;
    for (const fixture of ready) {
      const existing = await this.campaignWinnerModel
        .findOne({ fixtureId: fixture._id })
        .exec();
      if (existing && this.isResolvedCampaignWinner(existing)) continue;

      try {
        await this.processMatchResult(fixture._id.toHexString());
        processed++;
      } catch (err) {
        this.logger.error(
          `processPendingCampaignWinners: ${fixture.homeTeam.name} vs ${fixture.awayTeam.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (processed) {
      this.logger.log(`Processed ${processed} pending campaign winner(s) on startup`);
    }
    return processed;
  }

  /**
   * Determines and records the campaign winner for a finished match.
   * Uses the score already stored on the fixture (set by syncLiveScores)
   * rather than making a separate external API call.
   *
   * Winner logic:
   *   HOME_TEAM wins  → draw from option-0 voters
   *   AWAY_TEAM wins  → draw from option-1 voters
   *   DRAW, hasDrawOption=true  → draw from option-2 voters
   *   DRAW, hasDrawOption=false → draw from all voters (legacy 2-option posts)
   *   null / unknown  → record "no winner" without a userId
   *
   * Cooldown: after winning, a user sits out the next
   *   CAMPAIGN_WINNER_COOLDOWN_MATCHES processed match draws unless they
   *   predicted the exact final score.
   * Draw tiers (after cooldown filter):
   *   1. Exact score predictors (never-won preferred within that tier).
   *   2. No exact score → only voters who have never won before.
   *   3. No never-won left → weighted draw among past winners.
   */
  async processMatchResult(
    fixtureId: string,
    campaignId?: string,
  ): Promise<CampaignWinnerGql> {
    await this.ensureCampaignWinnerHistorySynced();

    if (!Types.ObjectId.isValid(fixtureId)) {
      throw new NotFoundException('Fixture not found');
    }
    const fixture = await this.fixtureModel.findById(fixtureId).exec();
    if (!fixture) throw new NotFoundException('Fixture not found');

    if (!fixture.campaignPostId) {
      throw new BadRequestException(
        'No campaign post exists for this fixture — call createCampaignPost first',
      );
    }
    if (fixture.status !== 'FINISHED') {
      throw new BadRequestException(
        `Match is not finished yet (status: ${fixture.status})`,
      );
    }

    // Idempotency guard — re-run if a prior sync left an empty stub row
    const existing = await this.campaignWinnerModel
      .findOne({ fixtureId: fixture._id })
      .exec();
    if (existing && this.isResolvedCampaignWinner(existing)) {
      return this.toGql(existing);
    }
    if (existing) {
      await this.campaignWinnerModel.deleteOne({ _id: existing._id });
    }

    const postId = fixture.campaignPostId;

    // Stamp the winner with its campaign so the per-campaign leaderboard can
    // filter on it. The announce cron calls this without a campaignId, so fall
    // back to the campaign the post belongs to.
    let campaignObjId =
      campaignId && Types.ObjectId.isValid(campaignId)
        ? new Types.ObjectId(campaignId)
        : undefined;
    if (!campaignObjId) {
      const campaignPost = await this.postModel
        .findById(postId)
        .select('campaignId')
        .exec();
      if (campaignPost?.campaignId) {
        campaignObjId = campaignPost.campaignId as Types.ObjectId;
      }
    }
    const scoreWinner = this.normalizeScoreWinner(fixture.score?.winner ?? null); // HOME_TEAM | AWAY_TEAM | DRAW | null
    const prize = campaignPrizeForFixtureStage(fixture.stage);

    // Unknown result — record without a winner userId
    if (!scoreWinner) {
      const record = await this.campaignWinnerModel.create({
        campaignId: campaignObjId,
        fixtureId: fixture._id,
        postId,
        prize,
        paid: false,
        note: 'No winner determined',
      });
      return this.toGql(record);
    }

    let winningOptionIndex: number | undefined;
    let voteFilter: Record<string, unknown>;
    let noWinnersNote: string;

    if (scoreWinner === 'DRAW') {
      if (fixture.hasDrawOption) {
        // Option 2 is the "Draw 🤝" option
        winningOptionIndex = 2;
        voteFilter = { postId, selectedOptionIndex: 2, anonymous: { $ne: true } };
        noWinnersNote = 'Match was a draw — no one voted for Draw 🤝';
      } else {
        // Legacy 2-option post: draw from all voters
        winningOptionIndex = undefined;
        voteFilter = { postId, anonymous: { $ne: true } };
        noWinnersNote = 'Match ended in a draw — no votes were cast';
      }
    } else {
      winningOptionIndex = scoreWinner === 'HOME_TEAM' ? 0 : 1;
      voteFilter = {
        postId,
        selectedOptionIndex: winningOptionIndex,
        anonymous: { $ne: true },
      };
      noWinnersNote = 'No users voted for the winning side';
    }

    const eligibleVotes = await this.voteModel
      .find(voteFilter)
      .lean()
      .exec();

    if (!eligibleVotes.length) {
      const record = await this.campaignWinnerModel.create({
        campaignId: campaignObjId,
        fixtureId: fixture._id,
        postId,
        prize,
        winningOption: winningOptionIndex,
        paid: false,
        note: noWinnersNote,
      });
      void this.notifyMatchResult(
        postId.toHexString(),
        fixture.homeTeam.name,
        fixture.awayTeam.name,
        null,
      );
      return this.toGql(record);
    }

    const finalHome = fixture.score?.home;
    const finalAway = fixture.score?.away;
    const exactPredictorIds =
      finalHome != null && finalAway != null
        ? await this.getExactPredictorUserIds(
            fixture._id,
            finalHome,
            finalAway,
          )
        : new Set<string>();

    const cooldownUserIds = await this.getCooldownUserIdSet(
      eligibleVotes.map((v) => v.userId),
      fixture._id,
    );

    const poolAfterCooldown = eligibleVotes.filter((v) => {
      const uid = v.userId.toString();
      if (!cooldownUserIds.has(uid)) return true;
      return exactPredictorIds.has(uid);
    });

    if (!poolAfterCooldown.length) {
      const record = await this.campaignWinnerModel.create({
        campaignId: campaignObjId,
        fixtureId: fixture._id,
        postId,
        prize,
        winningOption: winningOptionIndex,
        paid: false,
        note: `All eligible voters are on a ${CAMPAIGN_WINNER_COOLDOWN_MATCHES}-match winner cooldown — exact score required to win again`,
      });
      void this.notifyMatchResult(
        postId.toHexString(),
        fixture.homeTeam.name,
        fixture.awayTeam.name,
        null,
      );
      return this.toGql(record);
    }

    // ── Draw pool tiers ────────────────────────────────────────────────────
    // 1. Exact score → draw among exact scorers (never-won first if any).
    // 2. No exact score → draw only from never-won correct-side voters.
    // 3. If no never-won left → weighted draw among past winners (fallback).
    const pastWinCountByUser = await this.getPastWinCountByUser(
      poolAfterCooldown.map((v) => v.userId),
    );
    const { pool, wonViaExactScore, useWeightedDraw } =
      this.buildCampaignDrawPool(
        poolAfterCooldown,
        exactPredictorIds,
        pastWinCountByUser,
      );

    const drawn = useWeightedDraw
      ? this.drawWeightedCampaignWinner(pool, pastWinCountByUser)
      : this.drawUniformCampaignWinner(pool);
    const pickedAt = new Date();
    const record = await this.campaignWinnerModel.create({
      campaignId: campaignObjId,
      fixtureId: fixture._id,
      postId,
      userId: drawn.userId,
      prize,
      winningOption: winningOptionIndex,
      paid: false,
      ...(wonViaExactScore ? { note: 'Won via exact score prediction 🎯' } : {}),
    });
    // Stamp the post so claimPostVotePrize can verify winner eligibility
    await this.postModel.updateOne(
      { _id: postId },
      {
        $set: {
          voteWinnerUserId: drawn.userId,
          voteWinnerOptionIndex: winningOptionIndex ?? drawn.selectedOptionIndex,
          voteWinnerPickedAt: pickedAt,
        },
      },
    );
    // Coins: reward the drawn campaign winner (once per match post).
    await this.coinsService.award(
      drawn.userId.toHexString(),
      CoinType.CAMPAIGN_WINNER,
      postId.toHexString(),
    );
    void this.notifyMatchResult(
      postId.toHexString(),
      fixture.homeTeam.name,
      fixture.awayTeam.name,
      drawn.userId.toHexString(),
    );
    return this.toGql(record);
  }

  private normalizeScoreWinner(winner?: string | null): string | null {
    if (!winner) return null;
    switch (winner.toUpperCase()) {
      case 'HOME':
      case 'HOME_TEAM':
        return 'HOME_TEAM';
      case 'AWAY':
      case 'AWAY_TEAM':
        return 'AWAY_TEAM';
      case 'DRAW':
        return 'DRAW';
      default:
        return winner;
    }
  }

  /**
   * Winner gets VOTE_WINNER; all other non-anonymous voters get VOTE_ENDED.
   * Idempotent — guarded by voteEndedNotifiedAt on the post.
   */
  private async notifyMatchResult(
    postId: string,
    homeName: string,
    awayName: string,
    winnerId: string | null,
  ): Promise<void> {
    try {
      const postObjId = new Types.ObjectId(postId);

      // Guard: skip if already notified (e.g. cron fired twice before write landed)
      const post = await this.postModel
        .findOne({ _id: postObjId, voteEndedNotifiedAt: { $exists: false } })
        .lean()
        .exec();
      if (!post) return;

      // All non-anonymous voters for this post
      const allVotes = await this.voteModel
        .find({ postId: postObjId, anonymous: { $ne: true } })
        .distinct('userId')
        .exec();

      const allVoterIds: string[] = allVotes.map((id) => id.toHexString());
      const matchLabel = `${homeName} vs ${awayName}`;

      const nonWinnerIds = allVoterIds.filter((id) => id !== winnerId);

      await Promise.all([
        // Notify all voters that the match result is in
        ...nonWinnerIds.map((userId) =>
          this.notificationsService.create({
            userId,
            type: 'VOTE_ENDED' as NotificationType,
            title: 'Match result is in!',
            body: `${matchLabel} has ended. Check out who won the campaign.`,
            referenceId: postId,
            referenceType: 'Post',
            postId,
          }),
        ),
        // Notify the campaign winner
        ...(winnerId
          ? [
              this.notificationsService.create({
                userId: winnerId,
                type: 'VOTE_WINNER' as NotificationType,
                title: '🏆 You predicted correctly!',
                body: `You correctly predicted the result of ${matchLabel} and won the campaign!`,
                referenceId: postId,
                referenceType: 'Post',
                postId,
              }),
            ]
          : []),
      ]);

      // Mark notified so this never runs twice for the same post
      await this.postModel.updateOne(
        { _id: postObjId, voteEndedNotifiedAt: { $exists: false } },
        { $set: { voteEndedNotifiedAt: new Date() } },
      );
    } catch (err) {
      this.logger.warn(
        `Match result notification failed for post ${postId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Backfill CampaignWinner rows from finished fixtures / match posts so cooldown
   * and never-won tiers apply to history that predates this deploy.
   */
  private async syncHistoricalCampaignWinners(): Promise<number> {
    let backfilled = 0;

    const fixtures = await this.fixtureModel
      .find({
        campaignPostId: { $exists: true, $ne: null },
        status: 'FINISHED',
      })
      .select('_id campaignPostId stage matchEndedAt winnerScheduledAt')
      .lean()
      .exec();

    for (const fixture of fixtures) {
      const exists = await this.campaignWinnerModel
        .exists({ fixtureId: fixture._id })
        .exec();
      if (exists) continue;

      const post = await this.postModel
        .findById(fixture.campaignPostId)
        .select(
          'campaignId voteWinnerUserId voteWinnerOptionIndex voteWinnerPickedAt',
        )
        .lean()
        .exec();
      if (!post) continue;

      // Only backfill when the post already stores a completed draw — never
      // create empty stubs that block processMatchResult / the announce cron.
      if (!post.voteWinnerUserId || !post.voteWinnerPickedAt) continue;

      const pickedAt =
        post.voteWinnerPickedAt ??
        fixture.matchEndedAt ??
        fixture.winnerScheduledAt ??
        new Date();

      await this.campaignWinnerModel.create({
        campaignId: post.campaignId,
        fixtureId: fixture._id,
        postId: fixture.campaignPostId,
        userId: post.voteWinnerUserId ?? undefined,
        prize: campaignPrizeForFixtureStage(fixture.stage),
        winningOption: post.voteWinnerOptionIndex,
        paid: false,
        createdAt: pickedAt,
        updatedAt: pickedAt,
      });
      backfilled++;
    }

    const missingUser = await this.campaignWinnerModel
      .find({
        $or: [{ userId: null }, { userId: { $exists: false } }],
      })
      .select('_id postId winningOption')
      .lean()
      .exec();

    for (const row of missingUser) {
      const post = await this.postModel
        .findById(row.postId)
        .select('voteWinnerUserId voteWinnerOptionIndex')
        .lean()
        .exec();
      if (!post?.voteWinnerUserId) continue;
      await this.campaignWinnerModel.updateOne(
        { _id: row._id, userId: null },
        {
          $set: {
            userId: post.voteWinnerUserId,
            winningOption: post.voteWinnerOptionIndex ?? row.winningOption,
          },
        },
      );
    }

    if (backfilled) {
      this.logger.log(
        `Synced ${backfilled} historical campaign winner record(s) from past match posts`,
      );
    }
    return backfilled;
  }

  private async ensureCampaignWinnerHistorySynced(): Promise<void> {
    if (this.historySynced) return;
    await this.syncHistoricalCampaignWinners();
    this.historySynced = true;
  }

  /** User IDs with an exact-score prediction for the final result. */
  private async getExactPredictorUserIds(
    fixtureId: Types.ObjectId,
    finalHome: number,
    finalAway: number,
  ): Promise<Set<string>> {
    const ids = await this.matchPredictionModel
      .find({
        fixtureId,
        homeScore: finalHome,
        awayScore: finalAway,
      })
      .distinct('userId')
      .exec();
    return new Set(ids.map((id) => id.toString()));
  }

  /**
   * Users who won a recent match post and are still in the cooldown window
   * (next N processed matches after their last win).
   */
  private async getCooldownUserIdSet(
    voterUserIds: Types.ObjectId[],
    currentFixtureId: Types.ObjectId,
  ): Promise<Set<string>> {
    const voterSet = new Set(voterUserIds.map((id) => id.toString()));
    if (voterSet.size === 0) return new Set();

    // Every processed match (winner or not) advances the cooldown window.
    const timeline = await this.campaignWinnerModel
      .find({ fixtureId: { $ne: currentFixtureId } })
      .sort({ createdAt: 1 })
      .select('userId createdAt')
      .lean()
      .exec();

    const lastWinIndexByUser = new Map<string, number>();
    timeline.forEach((row, idx) => {
      const uid = row.userId?.toString();
      if (uid) lastWinIndexByUser.set(uid, idx);
    });

    const cooldown = new Set<string>();
    for (const uid of voterSet) {
      const lastIdx = lastWinIndexByUser.get(uid);
      if (lastIdx === undefined) continue;
      const matchesSince = timeline.length - lastIdx - 1;
      if (matchesSince < CAMPAIGN_WINNER_COOLDOWN_MATCHES) {
        cooldown.add(uid);
      }
    }
    return cooldown;
  }

  /** Total campaign wins per user (all time, excluding current fixture). */
  private async getPastWinCountByUser(
    userIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const unique = [
      ...new Set(userIds.map((id) => id.toString()).filter(Boolean)),
    ];
    if (!unique.length) return new Map();

    const rows = await this.campaignWinnerModel.aggregate<{
      _id: Types.ObjectId;
      wins: number;
    }>([
      {
        $match: {
          userId: {
            $in: unique.map((id) => new Types.ObjectId(id)),
          },
        },
      },
      { $group: { _id: '$userId', wins: { $sum: 1 } } },
    ]);

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row._id.toString(), row.wins);
    }
    return map;
  }

  private campaignWinnerDrawWeight(pastWins: number): number {
    if (pastWins <= 0) return CAMPAIGN_WINNER_FIRST_TIME_WEIGHT;
    if (pastWins === 1) return CAMPAIGN_WINNER_REPEAT_ONCE_WEIGHT;
    return CAMPAIGN_WINNER_REPEAT_MULTI_WEIGHT;
  }

  private buildCampaignDrawPool<T extends { userId: Types.ObjectId }>(
    poolAfterCooldown: T[],
    exactPredictorIds: Set<string>,
    pastWinCountByUser: Map<string, number>,
  ): {
    pool: T[];
    wonViaExactScore: boolean;
    useWeightedDraw: boolean;
  } {
    const isNeverWon = (entry: T) =>
      (pastWinCountByUser.get(entry.userId.toString()) ?? 0) === 0;
    const neverWon = poolAfterCooldown.filter(isNeverWon);
    const exactInPool = poolAfterCooldown.filter((entry) =>
      exactPredictorIds.has(entry.userId.toString()),
    );

    if (exactInPool.length) {
      const exactNeverWon = exactInPool.filter(isNeverWon);
      const pool = exactNeverWon.length ? exactNeverWon : exactInPool;
      return {
        pool,
        wonViaExactScore: true,
        useWeightedDraw: exactNeverWon.length === 0,
      };
    }

    if (neverWon.length) {
      return {
        pool: neverWon,
        wonViaExactScore: false,
        useWeightedDraw: false,
      };
    }

    const pastWinners = poolAfterCooldown.filter((entry) => !isNeverWon(entry));
    return {
      pool: pastWinners.length ? pastWinners : poolAfterCooldown,
      wonViaExactScore: false,
      useWeightedDraw: true,
    };
  }

  private drawUniformCampaignWinner<T>(pool: T[]): T {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Weighted random pick — used only when no first-time winners remain. */
  private drawWeightedCampaignWinner<
    T extends { userId: Types.ObjectId },
  >(pool: T[], pastWinCountByUser: Map<string, number>): T {
    if (pool.length === 1) return pool[0];

    let total = 0;
    const weights = pool.map((entry) => {
      const pastWins = pastWinCountByUser.get(entry.userId.toString()) ?? 0;
      const w = this.campaignWinnerDrawWeight(pastWins);
      total += w;
      return w;
    });

    if (total <= 0) {
      return pool[Math.floor(Math.random() * pool.length)];
    }

    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  async findByPostId(postId: string): Promise<CampaignWinnerGql | null> {
    if (!Types.ObjectId.isValid(postId)) return null;
    const doc = await this.campaignWinnerModel
      .findOne({ postId: new Types.ObjectId(postId) })
      .exec();
    return doc ? this.toGql(doc) : null;
  }

  async findByFixture(fixtureId: string): Promise<CampaignWinnerGql | null> {
    if (!Types.ObjectId.isValid(fixtureId)) return null;
    const doc = await this.campaignWinnerModel
      .findOne({ fixtureId: new Types.ObjectId(fixtureId) })
      .exec();
    return doc ? this.toGql(doc) : null;
  }

  async findAll(): Promise<CampaignWinnerGql[]> {
    const docs = await this.campaignWinnerModel
      .find()
      .sort({ createdAt: -1 })
      .exec();
    return Promise.all(docs.map((d) => this.toGql(d)));
  }

  /**
   * Leaderboard of users with the most campaign wins. Counts CampaignWinner
   * records that have a userId (real winners, not "no winner" rows), optionally
   * scoped to one campaign, grouped by user and sorted by win count desc.
   */
  async winLeaderboard(
    campaignId?: string,
    take = 50,
  ): Promise<CampaignWinLeaderboardEntryGql[]> {
    const match: Record<string, unknown> = { userId: { $ne: null } };
    if (campaignId && Types.ObjectId.isValid(campaignId)) {
      match.campaignId = new Types.ObjectId(campaignId);
    }
    const rows = await this.campaignWinnerModel.aggregate<{
      _id: Types.ObjectId;
      wins: number;
      totalPrize: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: '$userId',
          wins: { $sum: 1 },
          totalPrize: { $sum: { $ifNull: ['$prize', 0] } },
        },
      },
      { $sort: { wins: -1, totalPrize: -1 } },
      { $limit: Math.min(Math.max(1, take), 100) },
    ]);

    const entries = await Promise.all(
      rows.map(async (r, i) => {
        const userDoc = await this.usersService.findById(r._id.toHexString());
        return {
          rank: i + 1,
          wins: r.wins,
          totalPrize: r.totalPrize,
          user: userDoc ? this.usersService.toGql(userDoc) : null,
        };
      }),
    );
    return entries;
  }

  /** Public profile — campaign wins grouped by campaign with names. */
  async userCampaignWinSummary(
    userId: string,
  ): Promise<UserCampaignWinSummaryGql[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const uid = new Types.ObjectId(userId);
    const rows = await this.campaignWinnerModel.aggregate<{
      _id: Types.ObjectId | null;
      wins: number;
      totalPrize: number;
    }>([
      { $match: { userId: uid } },
      {
        $group: {
          _id: '$campaignId',
          wins: { $sum: 1 },
          totalPrize: { $sum: { $ifNull: ['$prize', 0] } },
        },
      },
      { $sort: { wins: -1, totalPrize: -1 } },
    ]);

    const summaries: UserCampaignWinSummaryGql[] = [];
    for (const row of rows) {
      let campaignName = 'Campaign';
      let campaignSlug = '';
      const campaignId = row._id?.toHexString() ?? null;
      if (row._id) {
        const camp = await this.campaignModel.findById(row._id).exec();
        if (camp) {
          campaignName = camp.name;
          campaignSlug = camp.slug;
        }
      }
      summaries.push({
        campaignId,
        campaignName,
        campaignSlug,
        wins: row.wins,
        totalPrize: row.totalPrize,
      });
    }
    return summaries;
  }

  async markPaid(winnerId: string): Promise<CampaignWinnerGql> {
    if (!Types.ObjectId.isValid(winnerId)) {
      throw new NotFoundException('Winner record not found');
    }
    const doc = await this.campaignWinnerModel.findById(winnerId).exec();
    if (!doc) throw new NotFoundException('Winner record not found');
    doc.paid = true;
    await doc.save();
    return this.toGql(doc);
  }

  async toGql(doc: CampaignWinnerDocument): Promise<CampaignWinnerGql> {
    let user = null;
    if (doc.userId) {
      const userDoc = await this.usersService.findById(
        doc.userId.toHexString(),
      );
      if (userDoc) user = this.usersService.toGql(userDoc);
    }
    return {
      id: doc._id.toHexString(),
      campaignId: doc.campaignId?.toHexString(),
      fixtureId: doc.fixtureId.toHexString(),
      postId: doc.postId.toHexString(),
      user,
      prize: doc.prize,
      winningOption: doc.winningOption,
      paid: doc.paid,
      note: doc.note,
      createdAt: doc.createdAt,
    };
  }
}
