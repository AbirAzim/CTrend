import {
  BadRequestException,
  Injectable,
  Logger,
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
import { PostsService } from '../posts/posts.service';

// ── API-Football (api-sports.io) ───────────────────────────────────────────
// Live World Cup scores / minute / goals. Replaces football-data.org, whose
// free tier never served live in-play data (all matches stuck on TIMED).
const AF_BASE = 'https://v3.football.api-sports.io';

interface AfTeam {
  id: number;
  name: string;
  logo: string;
}
interface AfFixtureItem {
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed: number | null };
    venue?: { name: string | null; city: string | null } | null;
  };
  league: { round: string };
  teams: { home: AfTeam; away: AfTeam };
  goals: { home: number | null; away: number | null };
}
interface AfStandingRow {
  team: { id: number; name: string };
  group?: string;
}

/**
 * Normalize API-Football status codes to the app's existing status vocabulary
 * (TIMED / IN_PLAY / PAUSED / FINISHED) so the frontend's live/finished/upcoming
 * logic keeps working without changes.
 */
function normalizeStatus(short: string): string {
  switch (short) {
    case '1H':
    case '2H':
    case 'ET':
    case 'BT':
    case 'P':
    case 'LIVE':
    case 'INT':
      return 'IN_PLAY';
    case 'HT':
      return 'PAUSED';
    case 'FT':
    case 'AET':
    case 'PEN':
      return 'FINISHED';
    // NS, TBD, PST, CANC, ABD, SUSP, AWD, WO → not (yet) played
    default:
      return 'TIMED';
  }
}

/** "Group Stage - 2" → 2; knockout rounds → null. */
function parseMatchday(round: string): number | null {
  const m = /(\d+)\s*$/.exec(round ?? '');
  return m ? Number(m[1]) : null;
}

/** API-Football round string → the app's stage vocabulary. */
function mapStage(round: string): string {
  const r = (round ?? '').toLowerCase();
  if (r.includes('group')) return 'GROUP_STAGE';
  if (r.includes('16')) return 'LAST_16';
  if (r.includes('quarter')) return 'QUARTER_FINALS';
  if (r.includes('semi')) return 'SEMI_FINALS';
  if (r.includes('3rd') || r.includes('third')) return 'THIRD_PLACE';
  if (r.includes('final')) return 'FINAL';
  return 'GROUP_STAGE';
}

/** "Group A" → "GROUP_A". */
function normalizeGroup(g?: string | null): string | null {
  if (!g) return null;
  const m = /group\s+([a-z])/i.exec(g);
  return m ? `GROUP_${m[1].toUpperCase()}` : null;
}

function deriveWinner(
  home: number | null,
  away: number | null,
  status: string,
): string | null {
  if (status !== 'FINISHED' || home == null || away == null) return null;
  if (home > away) return 'HOME_TEAM';
  if (away > home) return 'AWAY_TEAM';
  return 'DRAW';
}

@Injectable()
export class FixturesService {
  private readonly logger = new Logger(FixturesService.name);
  private readonly apiKey: string;
  private readonly league: string;
  private readonly season: string;

  constructor(
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private configService: ConfigService,
    private postsService: PostsService,
  ) {
    this.apiKey = this.configService.get<string>('API_FOOTBALL_KEY') ?? '';
    this.league =
      this.configService.get<string>('API_FOOTBALL_WC_LEAGUE') ?? '1';
    this.season =
      this.configService.get<string>('API_FOOTBALL_WC_SEASON') ?? '2026';
  }

  private async apiFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${AF_BASE}${path}`, {
      headers: { 'x-apisports-key': this.apiKey },
    });
    if (!res.ok) {
      throw new BadRequestException(
        `API-Football error: ${res.status} ${res.statusText}`,
      );
    }
    const json = (await res.json()) as { response?: T; errors?: unknown };
    // API-Football returns HTTP 200 with a non-empty `errors` on quota/param issues.
    const errs = json.errors;
    const hasErr = Array.isArray(errs)
      ? errs.length > 0
      : errs && typeof errs === 'object'
        ? Object.keys(errs).length > 0
        : false;
    if (hasErr) {
      throw new BadRequestException(
        `API-Football error: ${JSON.stringify(errs)}`,
      );
    }
    return json.response as T;
  }

  private fetchFixtures(): Promise<AfFixtureItem[]> {
    return this.apiFetch<AfFixtureItem[]>(
      `/fixtures?league=${this.league}&season=${this.season}`,
    );
  }

  /** teamId → "GROUP_A" from standings (the group letter isn't on fixtures). */
  private async fetchGroupMap(): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    try {
      const res = await this.apiFetch<
        Array<{ league: { standings: AfStandingRow[][] } }>
      >(`/standings?league=${this.league}&season=${this.season}`);
      const blocks = res?.[0]?.league?.standings ?? [];
      for (const block of blocks) {
        for (const row of block) {
          const g = normalizeGroup(row.group);
          if (g && row.team?.id) map.set(row.team.id, g);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Group map fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return map;
  }

  private mapItem(item: AfFixtureItem, groupMap: Map<number, string>) {
    const status = normalizeStatus(item.fixture.status.short);
    const home = item.goals.home;
    const away = item.goals.away;
    const venue = item.fixture.venue;
    // API-Football has no shortName/tla — keep the full name (frontend truncates).
    return {
      externalId: item.fixture.id,
      homeTeam: {
        name: item.teams.home.name ?? 'TBD',
        shortName: item.teams.home.name ?? 'TBD',
        crest: item.teams.home.logo ?? '',
      },
      awayTeam: {
        name: item.teams.away.name ?? 'TBD',
        shortName: item.teams.away.name ?? 'TBD',
        crest: item.teams.away.logo ?? '',
      },
      kickoff: new Date(item.fixture.date),
      status,
      minute:
        status === 'IN_PLAY' || status === 'PAUSED'
          ? (item.fixture.status.elapsed ?? null)
          : null,
      stage: mapStage(item.league.round),
      group: groupMap.get(item.teams.home.id) ?? null,
      matchday: parseMatchday(item.league.round),
      score: { home, away, winner: deriveWinner(home, away, status) },
      ...(venue?.name
        ? { venue: { name: venue.name, city: venue.city ?? '' } }
        : {}),
    };
  }

  /**
   * Full sync — every WC fixture + group mapping. Upserts all, then removes
   * fixtures no longer in the feed (e.g. the old football-data.org rows) unless
   * they're tied to a campaign post. Used by the admin `syncWorldCupFixtures`
   * mutation and the one-time provider migration.
   */
  async syncFixtures(): Promise<number> {
    if (!this.apiKey) {
      this.logger.warn('API_FOOTBALL_KEY missing — skipping fixtures sync');
      return 0;
    }
    const [items, groupMap] = await Promise.all([
      this.fetchFixtures(),
      this.fetchGroupMap(),
    ]);
    const seen: number[] = [];
    for (const item of items) {
      const doc = this.mapItem(item, groupMap);
      seen.push(doc.externalId);
      await this.fixtureModel.updateOne(
        { externalId: doc.externalId },
        { $set: doc },
        { upsert: true },
      );
    }
    if (seen.length > 0) {
      // `campaignPostId: null` matches both null and missing in Mongo — only
      // delete stale fixtures that aren't tied to a campaign post.
      await this.fixtureModel.deleteMany({
        externalId: { $nin: seen },
        campaignPostId: null,
      });
    }
    return seen.length;
  }

  /**
   * Cron updater — refreshes only the dynamic fields (status / minute / score)
   * for all WC fixtures in one call, so live matches tick and finished ones flip
   * to FINISHED. Leaves teams/stage/group untouched (set by the full sync).
   */
  async syncLiveScores(): Promise<number> {
    const items = await this.fetchFixtures();
    let updated = 0;
    for (const item of items) {
      const status = normalizeStatus(item.fixture.status.short);
      const home = item.goals.home;
      const away = item.goals.away;
      await this.fixtureModel.updateOne(
        { externalId: item.fixture.id },
        {
          $set: {
            status,
            minute:
              status === 'IN_PLAY' || status === 'PAUSED'
                ? (item.fixture.status.elapsed ?? null)
                : null,
            score: { home, away, winner: deriveWinner(home, away, status) },
          },
        },
      );
      updated++;
    }
    return updated;
  }

  /**
   * True when a match is in play, or a scheduled match is within ~15 min of
   * kickoff (or just kicked off but not yet flipped to live). Gates the cron so
   * we only hit the API during real match windows.
   */
  private async hasActiveWindow(): Promise<boolean> {
    const now = Date.now();
    const soon = new Date(now + 15 * 60 * 1000);
    const recent = new Date(now - 3 * 60 * 60 * 1000);
    const count = await this.fixtureModel
      .countDocuments({
        $or: [
          { status: { $in: ['IN_PLAY', 'PAUSED'] } },
          {
            status: { $in: ['SCHEDULED', 'TIMED'] },
            kickoff: { $gte: recent, $lte: soon },
          },
        ],
      })
      .exec();
    return count > 0;
  }

  /**
   * Cron entry point: refresh live scores only during live/imminent windows so
   * the API quota isn't wasted when nothing is on. Returns the number of
   * fixtures refreshed, or null when it skipped (no key / no window).
   */
  async syncLiveIfActive(): Promise<number | null> {
    if (!this.apiKey) return null;
    if (!(await this.hasActiveWindow())) return null;
    return this.syncLiveScores();
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
      await this.postsService.onPostPublished(post._id.toHexString());
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
      minute: fixture.minute ?? null,
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
