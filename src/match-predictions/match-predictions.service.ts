import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MatchPrediction,
  MatchPredictionDocument,
} from './match-prediction.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { Fixture, FixtureDocument } from '../fixtures/fixture.schema';
import { UsersService } from '../users/users.service';
import { MatchPredictionGql } from './graphql/match-prediction.types';
import { pubsub, MATCH_PREDICTION_UPDATED } from '../pubsub';
import { CoinsService } from '../coins/coins.service';
import { CoinType } from '../coins/coins.constants';

type MatchContext = { post: PostDocument; fixture: FixtureDocument };

@Injectable()
export class MatchPredictionsService {
  constructor(
    @InjectModel(MatchPrediction.name)
    private readonly predictionModel: Model<MatchPredictionDocument>,
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    @InjectModel(Fixture.name)
    private readonly fixtureModel: Model<FixtureDocument>,
    private readonly usersService: UsersService,
    private readonly coinsService: CoinsService,
  ) {}

  /** Resolve + validate that this post is a match post with a linked fixture. */
  private async loadContext(postId: string): Promise<MatchContext> {
    if (!Types.ObjectId.isValid(postId)) {
      throw new NotFoundException('Post not found');
    }
    const post = await this.postModel.findById(postId).exec();
    if (!post || !post.matchType) {
      throw new NotFoundException('Not a match post');
    }
    // Prefer the denormalised fixtureId; fall back to the fixture's reverse link
    // for posts created before fixtureId was stored at creation time.
    let fixture = post.fixtureId
      ? await this.fixtureModel.findById(post.fixtureId).exec()
      : null;
    if (!fixture) {
      fixture = await this.fixtureModel
        .findOne({ campaignPostId: post._id })
        .exec();
    }
    if (!fixture) throw new NotFoundException('Fixture not found');
    return { post, fixture };
  }

  /** Predictions can be submitted/edited/deleted only before kickoff. */
  private isOpen(fixture: FixtureDocument): boolean {
    return Date.now() < new Date(fixture.kickoff).getTime();
  }

  /** Match finished with a known score → winners can be listed. */
  private isResolved(fixture: FixtureDocument): boolean {
    return (
      fixture.status === 'FINISHED' &&
      fixture.score?.home != null &&
      fixture.score?.away != null
    );
  }

  private isWinningScore(
    fixture: FixtureDocument,
    homeScore: number,
    awayScore: number,
  ): boolean {
    if (!this.isResolved(fixture)) return false;
    // Pre-penalty score (fixture.score is set from API goals incl. extra time).
    return (
      fixture.score.home === homeScore && fixture.score.away === awayScore
    );
  }

  private async toGql(
    doc: MatchPredictionDocument,
    fixture: FixtureDocument,
  ): Promise<MatchPredictionGql> {
    const user = await this.usersService.findById(doc.userId.toHexString());
    return {
      id: doc._id.toHexString(),
      homeScore: doc.homeScore,
      awayScore: doc.awayScore,
      createdAt: doc.createdAt ?? new Date(),
      updatedAt: doc.updatedAt ?? doc.createdAt ?? new Date(),
      user: user ? this.usersService.toGql(user) : null,
      isWinner: this.isWinningScore(fixture, doc.homeScore, doc.awayScore),
    };
  }

  async submit(
    userId: string,
    postId: string,
    homeScore: number,
    awayScore: number,
  ): Promise<MatchPredictionGql> {
    const { fixture } = await this.loadContext(postId);
    if (!this.isOpen(fixture)) {
      throw new ForbiddenException('Predictions are closed — the match has started');
    }
    if (
      !Number.isInteger(homeScore) ||
      !Number.isInteger(awayScore) ||
      homeScore < 0 ||
      awayScore < 0 ||
      homeScore > 99 ||
      awayScore > 99
    ) {
      throw new ForbiddenException('Invalid score');
    }
    const uid = new Types.ObjectId(userId);
    const pid = new Types.ObjectId(postId);
    const fid = new Types.ObjectId(fixture._id);
    await this.predictionModel.updateOne(
      { userId: uid, postId: pid },
      { $set: { homeScore, awayScore, fixtureId: fid } },
      { upsert: true },
    );
    const doc = await this.predictionModel
      .findOne({ userId: uid, postId: pid })
      .exec();
    // Coins: reward making a prediction (once per post — edits don't re-award).
    await this.coinsService.award(userId, CoinType.PREDICTION, postId);
    await this.publishUpdate(postId);
    return this.toGql(doc as MatchPredictionDocument, fixture);
  }

  async remove(userId: string, postId: string): Promise<boolean> {
    const { fixture } = await this.loadContext(postId);
    if (!this.isOpen(fixture)) {
      throw new ForbiddenException('Predictions are closed — the match has started');
    }
    await this.predictionModel
      .deleteOne({
        userId: new Types.ObjectId(userId),
        postId: new Types.ObjectId(postId),
      })
      .exec();
    await this.publishUpdate(postId);
    return true;
  }

  async list(
    postId: string,
    skip = 0,
    take?: number,
  ): Promise<MatchPredictionGql[]> {
    const { fixture } = await this.loadContext(postId);
    let cursor = this.predictionModel
      .find({ postId: new Types.ObjectId(postId) })
      .sort({ createdAt: -1 })
      .skip(Math.max(0, skip));
    if (take !== undefined && take > 0) cursor = cursor.limit(take);
    const rows = await cursor.exec();
    return Promise.all(rows.map((r) => this.toGql(r, fixture)));
  }

  async listWinners(postId: string): Promise<MatchPredictionGql[]> {
    const { fixture } = await this.loadContext(postId);
    if (!this.isResolved(fixture)) return [];
    const rows = await this.predictionModel
      .find({
        postId: new Types.ObjectId(postId),
        homeScore: fixture.score.home,
        awayScore: fixture.score.away,
      })
      .sort({ createdAt: 1 })
      .exec();
    return Promise.all(rows.map((r) => this.toGql(r, fixture)));
  }

  async getState(
    postId: string,
    viewerId?: string,
  ): Promise<{
    myPrediction: MatchPredictionGql | null;
    count: number;
    predictionsOpen: boolean;
    predictionsResolved: boolean;
  }> {
    const { fixture } = await this.loadContext(postId);
    const pid = new Types.ObjectId(postId);
    const [count, mine] = await Promise.all([
      this.predictionModel.countDocuments({ postId: pid }),
      viewerId
        ? this.predictionModel
            .findOne({ postId: pid, userId: new Types.ObjectId(viewerId) })
            .exec()
        : Promise.resolve(null),
    ]);
    return {
      myPrediction: mine ? await this.toGql(mine, fixture) : null,
      count,
      predictionsOpen: this.isOpen(fixture),
      predictionsResolved: this.isResolved(fixture),
    };
  }

  /**
   * Award the correct-prediction bonus to everyone who nailed the exact
   * (pre-penalty) score. Idempotent — safe to call repeatedly on the same
   * finished fixture. Called by FixturesService when a match transitions to
   * FINISHED.
   */
  async awardWinners(
    postId: string,
    homeScore: number,
    awayScore: number,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(postId)) return;
    const winners = await this.predictionModel
      .find({
        postId: new Types.ObjectId(postId),
        homeScore,
        awayScore,
      })
      .exec();
    for (const w of winners) {
      // refId = postId so each winner is rewarded exactly once per match.
      await this.coinsService.award(
        w.userId.toHexString(),
        CoinType.PREDICTION_CORRECT,
        postId,
      );
    }
  }

  private async publishUpdate(postId: string): Promise<void> {
    await pubsub.publish(MATCH_PREDICTION_UPDATED, {
      matchPredictionUpdated: { postId },
    });
  }
}
