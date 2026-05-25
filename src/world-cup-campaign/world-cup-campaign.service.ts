import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  CampaignWinner,
  CampaignWinnerDocument,
} from './campaign-winner.schema';
import { Fixture, FixtureDocument } from '../fixtures/fixture.schema';
import { Vote, VoteDocument } from '../votes/vote.schema';
import { UsersService } from '../users/users.service';
import { CampaignWinnerGql } from './graphql/campaign-winner.types';

const WC_API_BASE = 'https://api.football-data.org/v4';

@Injectable()
export class WorldCupCampaignService {
  private readonly apiKey: string;

  constructor(
    @InjectModel(CampaignWinner.name)
    private campaignWinnerModel: Model<CampaignWinnerDocument>,
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    private usersService: UsersService,
    private configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('FOOTBALL_DATA_API_KEY') ?? '';
  }

  async processMatchResult(fixtureId: string, campaignId?: string): Promise<CampaignWinnerGql> {
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

    // Check idempotency
    const existing = await this.campaignWinnerModel
      .findOne({ fixtureId: fixture._id })
      .exec();
    if (existing) {
      return this.toGql(existing);
    }

    const campaignObjId =
      campaignId && Types.ObjectId.isValid(campaignId)
        ? new Types.ObjectId(campaignId)
        : undefined;

    // Fetch latest result from football-data.org
    const res = await fetch(`${WC_API_BASE}/matches/${fixture.externalId}`, {
      headers: { 'X-Auth-Token': this.apiKey },
    });
    if (!res.ok) {
      throw new BadRequestException(
        `football-data.org error: ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as {
      match: {
        status: string;
        score: {
          winner: string | null;
          fullTime: { home: number | null; away: number | null };
        };
      };
    };
    const match = data.match;

    if (match.status !== 'FINISHED') {
      throw new BadRequestException(
        `Match is not finished yet (status: ${match.status})`,
      );
    }

    // Update fixture score in DB
    fixture.status = match.status;
    fixture.score = {
      home: match.score.fullTime.home,
      away: match.score.fullTime.away,
      winner: match.score.winner,
    };
    await fixture.save();

    const postId = fixture.campaignPostId;
    const apiWinner = match.score.winner; // HOME_TEAM | AWAY_TEAM | DRAW | null

    // Draw: all voters are eligible; unknown winner: bail out
    if (!apiWinner || apiWinner === 'DRAW') {
      if (apiWinner !== 'DRAW') {
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

      const allVotes = await this.voteModel
        .find({ postId, anonymous: { $ne: true } })
        .lean()
        .exec();

      if (!allVotes.length) {
        const record = await this.campaignWinnerModel.create({
          campaignId: campaignObjId,
          fixtureId: fixture._id,
          postId,
          prize: 100,
          paid: false,
          note: 'Match ended in a draw — no votes were cast',
        });
        return this.toGql(record);
      }

      const drawn = allVotes[Math.floor(Math.random() * allVotes.length)];
      const record = await this.campaignWinnerModel.create({
        campaignId: campaignObjId,
        fixtureId: fixture._id,
        postId,
        userId: drawn.userId,
        prize: 100,
        paid: false,
        note: 'Match ended in a draw — winner drawn from all voters',
      });
      return this.toGql(record);
    }

    // HOME_TEAM = option index 0, AWAY_TEAM = option index 1
    const winningOptionIndex = apiWinner === 'HOME_TEAM' ? 0 : 1;

    const correctVotes = await this.voteModel
      .find({
        postId,
        selectedOptionIndex: winningOptionIndex,
        anonymous: { $ne: true },
      })
      .lean()
      .exec();

    if (!correctVotes.length) {
      const record = await this.campaignWinnerModel.create({
        campaignId: campaignObjId,
        fixtureId: fixture._id,
        postId,
        prize: 100,
        winningOption: winningOptionIndex,
        paid: false,
        note: 'No users voted for the winning side',
      });
      return this.toGql(record);
    }

    const drawn = correctVotes[Math.floor(Math.random() * correctVotes.length)];
    const record = await this.campaignWinnerModel.create({
      campaignId: campaignObjId,
      fixtureId: fixture._id,
      postId,
      userId: drawn.userId,
      prize: 100,
      winningOption: winningOptionIndex,
      paid: false,
    });
    return this.toGql(record);
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
