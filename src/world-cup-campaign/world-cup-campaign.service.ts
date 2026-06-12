import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CampaignWinner,
  CampaignWinnerDocument,
} from './campaign-winner.schema';
import { Fixture, FixtureDocument } from '../fixtures/fixture.schema';
import { Vote, VoteDocument } from '../votes/vote.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.schema';
import { CampaignWinnerGql } from './graphql/campaign-winner.types';

@Injectable()
export class WorldCupCampaignService {
  private readonly logger = new Logger(WorldCupCampaignService.name);

  constructor(
    @InjectModel(CampaignWinner.name)
    private campaignWinnerModel: Model<CampaignWinnerDocument>,
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private usersService: UsersService,
    private notificationsService: NotificationsService,
  ) {}

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
   */
  async processMatchResult(
    fixtureId: string,
    campaignId?: string,
  ): Promise<CampaignWinnerGql> {
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

    // Idempotency guard
    const existing = await this.campaignWinnerModel
      .findOne({ fixtureId: fixture._id })
      .exec();
    if (existing) return this.toGql(existing);

    const campaignObjId =
      campaignId && Types.ObjectId.isValid(campaignId)
        ? new Types.ObjectId(campaignId)
        : undefined;

    const postId = fixture.campaignPostId;
    const scoreWinner = fixture.score?.winner ?? null; // HOME_TEAM | AWAY_TEAM | DRAW | null

    // Unknown result — record without a winner userId
    if (!scoreWinner) {
      const record = await this.campaignWinnerModel.create({
        campaignId: campaignObjId,
        fixtureId: fixture._id,
        postId,
        prize: 100,
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
        prize: 100,
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

    const drawn =
      eligibleVotes[Math.floor(Math.random() * eligibleVotes.length)];
    const record = await this.campaignWinnerModel.create({
      campaignId: campaignObjId,
      fixtureId: fixture._id,
      postId,
      userId: drawn.userId,
      prize: 100,
      winningOption: winningOptionIndex,
      paid: false,
    });
    void this.notifyMatchResult(
      postId.toHexString(),
      fixture.homeTeam.name,
      fixture.awayTeam.name,
      drawn.userId.toHexString(),
    );
    return this.toGql(record);
  }

  /**
   * Fan-out notifications after a match result is processed.
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
