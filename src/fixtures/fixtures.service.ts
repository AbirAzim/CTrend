import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Fixture, FixtureDocument } from './fixture.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { Category, CategoryDocument } from '../categories/category.schema';
import { FixtureFilterInput, FixtureGql } from './graphql/fixture.types';
import { PostStatus, PostType, Visibility } from '../common/enums';
import { NEW_POST, pubsub } from '../pubsub';

const WC_API_BASE = 'https://api.football-data.org/v4';
const WC_COMPETITION = 'WC';

interface ApiTeam {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest: string;
}

interface ApiMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string;
  group: string | null;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
  score: {
    winner: string | null;
    fullTime: { home: number | null; away: number | null };
  };
}

@Injectable()
export class FixturesService {
  private readonly apiKey: string;

  constructor(
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('FOOTBALL_DATA_API_KEY') ?? '';
  }

  private async apiFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${WC_API_BASE}${path}`, {
      headers: { 'X-Auth-Token': this.apiKey },
    });
    if (!res.ok) {
      throw new BadRequestException(
        `football-data.org error: ${res.status} ${res.statusText}`,
      );
    }
    return res.json() as Promise<T>;
  }

  async syncFixtures(): Promise<number> {
    const data = await this.apiFetch<{ matches: ApiMatch[] }>(
      `/competitions/${WC_COMPETITION}/matches`,
    );
    const matches = data.matches ?? [];
    let upserted = 0;
    for (const m of matches) {
      await this.fixtureModel.updateOne(
        { externalId: m.id },
        {
          $set: {
            externalId: m.id,
            homeTeam: {
              name: m.homeTeam.name ?? 'TBD',
              shortName: m.homeTeam.shortName || m.homeTeam.tla || 'TBD',
              crest: m.homeTeam.crest ?? '',
            },
            awayTeam: {
              name: m.awayTeam.name ?? 'TBD',
              shortName: m.awayTeam.shortName || m.awayTeam.tla || 'TBD',
              crest: m.awayTeam.crest ?? '',
            },
            kickoff: new Date(m.utcDate),
            status: m.status,
            stage: m.stage,
            group: m.group ?? null,
            matchday: m.matchday ?? null,
            score: {
              home: m.score.fullTime.home,
              away: m.score.fullTime.away,
              winner: m.score.winner,
            },
          },
        },
        { upsert: true },
      );
      upserted++;
    }
    return upserted;
  }

  async fetchAndUpdateSingleMatch(externalId: number): Promise<ApiMatch> {
    const data = await this.apiFetch<{ match: ApiMatch }>(
      `/matches/${externalId}`,
    );
    return data.match;
  }

  async findAll(filter?: FixtureFilterInput): Promise<FixtureDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter?.stage) query.stage = filter.stage;
    if (filter?.group) query.group = filter.group;
    return this.fixtureModel.find(query).sort({ kickoff: 1 }).exec();
  }

  async findById(id: string): Promise<FixtureDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.fixtureModel.findById(id).exec();
  }

  async createCampaignPost(
    fixtureId: string,
    adminId: string,
  ): Promise<PostDocument> {
    const fixture = await this.findById(fixtureId);
    if (!fixture) throw new NotFoundException('Fixture not found');

    if (fixture.campaignPostId) {
      throw new BadRequestException(
        'Campaign post already exists for this fixture',
      );
    }

    const sportsCategory = await this.categoryModel
      .findOne({ slug: 'sports' })
      .exec();
    if (!sportsCategory) {
      throw new BadRequestException(
        'Sports category not found — run the server once to seed categories',
      );
    }

    const kickoff = fixture.kickoff;
    const twentyFourHoursBefore = new Date(
      kickoff.getTime() - 24 * 60 * 60 * 1000,
    );
    const now = new Date();

    const isScheduled = twentyFourHoursBefore > now;
    const scheduledAt = isScheduled ? twentyFourHoursBefore : undefined;
    const status = isScheduled ? PostStatus.SCHEDULED : PostStatus.PUBLISHED;

    const home = fixture.homeTeam.name;
    const away = fixture.awayTeam.name;

    const post = await this.postModel.create({
      type: PostType.SYSTEM,
      contentText: `🏆 World Cup Fever: Who will win? ${home} vs ${away}`,
      imageUrls: [],
      options: [{ label: home }, { label: away }],
      categoryId: sportsCategory._id,
      visibility: Visibility.PUBLIC,
      createdBy: new Types.ObjectId(adminId),
      feedPriority: 100,
      voteCount: 0,
      commentsDisabled: false,
      likesDisabled: false,
      votingEndsAt: kickoff,
      status,
      scheduledAt,
    });

    fixture.campaignPostId = post._id as Types.ObjectId;
    await fixture.save();

    if (status === PostStatus.PUBLISHED) {
      await pubsub.publish(NEW_POST, {
        newPost: { postId: post._id.toHexString() },
      });
    }

    return post;
  }

  toGql(fixture: FixtureDocument): FixtureGql {
    return {
      id: fixture._id.toHexString(),
      externalId: fixture.externalId,
      homeTeam: {
        name: fixture.homeTeam.name,
        shortName: fixture.homeTeam.shortName,
        crest: fixture.homeTeam.crest,
      },
      awayTeam: {
        name: fixture.awayTeam.name,
        shortName: fixture.awayTeam.shortName,
        crest: fixture.awayTeam.crest,
      },
      kickoff: fixture.kickoff,
      status: fixture.status,
      stage: fixture.stage,
      group: fixture.group,
      matchday: fixture.matchday,
      score: {
        home: fixture.score?.home ?? null,
        away: fixture.score?.away ?? null,
        winner: fixture.score?.winner ?? null,
      },
      venue: fixture.venue
        ? { name: fixture.venue.name, city: fixture.venue.city }
        : undefined,
      campaignPostId: fixture.campaignPostId?.toHexString(),
    };
  }
}
