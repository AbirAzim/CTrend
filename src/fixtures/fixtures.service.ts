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
import { PostFormat, PostStatus, PostType, Visibility } from '../common/enums';
import { PostsService } from '../posts/posts.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { NotificationsService } from '../notifications/notifications.service';
import { generateMatchCaption } from './caption-templates';
import { POST_UPDATED, pubsub } from '../pubsub';

// ── API-Football ──────────────────────────────────────────────────────────
// Supports both direct api-sports.io and RapidAPI hosting.
// Set API_FOOTBALL_PROVIDER=rapidapi in .env to use RapidAPI (recommended —
// free tier includes events/lineups/statistics; direct api-sports.io requires
// a higher plan for those endpoints).
const AF_BASE_DIRECT = 'https://v3.football.api-sports.io';
const AF_BASE_RAPID = 'https://api-football-v1.p.rapidapi.com/v3';

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
  league: { id: number; round: string };
  teams: { home: AfTeam; away: AfTeam };
  goals: { home: number | null; away: number | null };
}
interface AfStandingRow {
  team: { id: number; name: string };
  group?: string;
}
interface AfEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null } | null;
  type: string;
  detail: string;
  comments: string | null;
}
interface AfLineupPlayer {
  id: number;
  name: string;
  number: number;
  pos: string;
  grid: string | null;
  photo?: string | null;
}
interface AfLineupTeam {
  team: { id: number; name: string };
  formation: string;
  startXI: Array<{ player: AfLineupPlayer }>;
  substitutes: Array<{ player: AfLineupPlayer }>;
  coach: { id: number; name: string; photo?: string | null };
}
interface AfStatItem {
  type: string;
  value: string | number | null;
}
interface AfStatTeam {
  team: { id: number; name: string };
  statistics: AfStatItem[];
}
interface AfPlayerStatEntry {
  player: { id: number; name: string; photo: string };
  statistics: Array<{ games: { rating: string | null; minutes: number | null } }>;
}
interface AfPlayerStatTeam {
  team: { id: number; name: string };
  players: AfPlayerStatEntry[];
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
  private readonly rapidApiKey: string;
  private readonly league: string;
  private readonly season: string;
  private readonly useRapidApi: boolean;
  /** Tracks last detail-sync timestamp per fixture externalId to throttle expensive sub-calls. */
  private readonly lastDetailSync = new Map<number, number>();
  /** How often to re-fetch events/stats/lineups per fixture while live (ms). */
  private static readonly DETAIL_SYNC_INTERVAL = 3 * 60 * 1000; // 3 min

  constructor(
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private configService: ConfigService,
    private postsService: PostsService,
    private campaignsService: CampaignsService,
    private notificationsService: NotificationsService,
  ) {
    this.apiKey = this.configService.get<string>('API_FOOTBALL_KEY') ?? '';
    this.rapidApiKey = this.configService.get<string>('RAPID_API_FOOTBALL_KEY') ?? '';
    this.useRapidApi = !!this.rapidApiKey || this.configService.get<string>('API_FOOTBALL_PROVIDER') === 'rapidapi';
    this.league =
      this.configService.get<string>('API_FOOTBALL_WC_LEAGUE') ?? '1';
    this.season =
      this.configService.get<string>('API_FOOTBALL_WC_SEASON') ?? '2026';
    this.logger.log(
      `API-Football provider: ${this.useRapidApi ? 'RapidAPI' : 'api-sports.io (direct)'}`,
    );
  }

  private async apiFetch<T>(path: string): Promise<T> {
    const key = this.useRapidApi ? this.rapidApiKey : this.apiKey;
    const base = this.useRapidApi ? AF_BASE_RAPID : AF_BASE_DIRECT;
    const url = `${base}${path}`;
    const headers: Record<string, string> = this.useRapidApi
      ? {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
        }
      : { 'x-apisports-key': key };
    this.logger.debug(`API-Football → ${url} (key: ${key ? key.slice(0, 6) + '…' : 'MISSING'})`);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new BadRequestException(
        `API-Football error: ${res.status} ${res.statusText} — URL: ${url}`,
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

  /** Fetch only currently-live fixtures — 1 API call, real-time on pro plan.
   * The API requires `live=all` or `live=id-id-id`; a bare league id is invalid. */
  private async fetchLiveFixtures(): Promise<AfFixtureItem[]> {
    const all = await this.apiFetch<AfFixtureItem[]>('/fixtures?live=all');
    const leagueId = Number(this.league);
    return all.filter((item) => item.league.id === leagueId);
  }

  private fetchMatchEvents(externalId: number): Promise<AfEvent[]> {
    return this.apiFetch<AfEvent[]>(`/fixtures/events?fixture=${externalId}`);
  }

  private fetchMatchLineups(externalId: number): Promise<AfLineupTeam[]> {
    return this.apiFetch<AfLineupTeam[]>(
      `/fixtures/lineups?fixture=${externalId}`,
    );
  }

  private fetchMatchStats(externalId: number): Promise<AfStatTeam[]> {
    return this.apiFetch<AfStatTeam[]>(
      `/fixtures/statistics?fixture=${externalId}`,
    );
  }

  private fetchPlayerRatings(externalId: number): Promise<AfPlayerStatTeam[]> {
    return this.apiFetch<AfPlayerStatTeam[]>(
      `/fixtures/players?fixture=${externalId}`,
    );
  }

  async syncMatchDetails(
    fixture: FixtureDocument,
    includeLineups = true,
  ): Promise<{ events: number; stats: number; lineups: number; error?: string }> {
    const externalId = fixture.externalId;
    this.logger.log(`Syncing match details for fixture ${externalId} (${fixture.homeTeam.name} vs ${fixture.awayTeam.name})`);
    try {
      const [eventsResult, statsResult, lineupsResult, ratingsResult] = await Promise.allSettled([
        this.fetchMatchEvents(externalId),
        this.fetchMatchStats(externalId),
        includeLineups ? this.fetchMatchLineups(externalId) : Promise.resolve(null),
        this.fetchPlayerRatings(externalId),
      ]);

      if (eventsResult.status === 'rejected') this.logger.error(`Events fetch failed: ${String(eventsResult.reason)}`);
      if (statsResult.status === 'rejected') this.logger.error(`Stats fetch failed: ${String(statsResult.reason)}`);
      if (lineupsResult.status === 'rejected') this.logger.error(`Lineups fetch failed: ${String(lineupsResult.reason)}`);
      if (ratingsResult.status === 'rejected') this.logger.error(`Ratings fetch failed: ${String(ratingsResult.reason)}`);

      const eventsRaw = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
      const statsRaw = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const lineupsRaw = lineupsResult.status === 'fulfilled' ? lineupsResult.value : null;
      const ratingsRaw = ratingsResult.status === 'fulfilled' ? ratingsResult.value : null;

      const anyError =
        (eventsResult.status === 'rejected' ? String(eventsResult.reason) : null) ??
        (statsResult.status === 'rejected' ? String(statsResult.reason) : null) ??
        (lineupsResult.status === 'rejected' ? String(lineupsResult.reason) : null) ??
        (ratingsResult.status === 'rejected' ? String(ratingsResult.reason) : null);

      const homeId = fixture.homeTeamExternalId;
      const awayId = fixture.awayTeamExternalId;

      const events = (eventsRaw ?? []).map((e) => ({
        time: e.time.elapsed,
        timeExtra: e.time.extra ?? null,
        team:
          homeId != null && e.team.id === homeId
            ? 'home'
            : awayId != null && e.team.id === awayId
              ? 'away'
              : e.team.name === fixture.homeTeam.name
                ? 'home'
                : 'away',
        type: e.type,
        detail: e.detail,
        player: { id: e.player?.id ?? null, name: e.player?.name ?? null },
        assist: e.assist?.name
          ? { id: e.assist.id ?? null, name: e.assist.name }
          : null,
      }));

      // Build paired stats: home value / away value per stat type
      const homeStats = statsRaw?.[0]?.statistics ?? [];
      const awayStats = statsRaw?.[1]?.statistics ?? [];
      const awayMap = new Map(awayStats.map((s) => [s.type, s.value]));
      const stats = homeStats.map((s) => ({
        type: s.type,
        home: s.value != null ? String(s.value) : null,
        away: awayMap.has(s.type)
          ? awayMap.get(s.type) != null
            ? String(awayMap.get(s.type))
            : null
          : null,
      }));

      const playerRatings = (ratingsRaw ?? []).flatMap((teamData) => {
        const teamSide =
          teamData.team.id === homeId || teamData.team.name === fixture.homeTeam.name
            ? 'home'
            : 'away';
        return (teamData.players ?? [])
          .filter((p) => p.statistics?.[0]?.games?.rating != null)
          .map((p) => ({
            playerId: p.player.id,
            name: p.player.name,
            team: teamSide,
            rating: p.statistics[0].games.rating,
            photo: p.player.photo
              ?? `https://media.api-sports.io/football/players/${p.player.id}.png`,
          }));
      });

      const update: Record<string, unknown> = {
        events,
        stats,
        playerRatings,
        detailsSyncedAt: new Date(),
      };

      const hadLineups = Array.isArray(fixture.lineups) && fixture.lineups.length > 0;
      let newLineupsCount = 0;

      if (lineupsRaw != null && lineupsRaw.length > 0) {
        const lineups = lineupsRaw.map((l) => ({
          team: l.team.id === homeId || l.team.name === fixture.homeTeam.name ? 'home' : 'away',
          formation: l.formation,
          startXI: l.startXI.map((p) => ({
            id: p.player.id ?? null,
            name: p.player.name,
            number: p.player.number,
            pos: p.player.pos ?? null,
            grid: p.player.grid ?? null,
            photo: p.player.photo
              ?? (p.player.id ? `https://media.api-sports.io/football/players/${p.player.id}.png` : null),
          })),
          substitutes: l.substitutes.map((p) => ({
            id: p.player.id ?? null,
            name: p.player.name,
            number: p.player.number,
            pos: p.player.pos ?? null,
            grid: p.player.grid ?? null,
            photo: p.player.photo
              ?? (p.player.id ? `https://media.api-sports.io/football/players/${p.player.id}.png` : null),
          })),
          coach: l.coach
            ? { id: l.coach.id ?? null, name: l.coach.name, photo: l.coach.photo ?? null }
            : null,
        }));
        update.lineups = lineups;
        newLineupsCount = lineups.length;
      }

      await this.fixtureModel.updateOne(
        { _id: fixture._id },
        { $set: update },
      );

      // When lineups are newly available, update the linked post and notify all users
      const lineupsJustArrived = !hadLineups && newLineupsCount > 0;
      if (lineupsJustArrived && fixture.campaignPostId) {
        const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
        const postIdStr = fixture.campaignPostId.toHexString();
        const matchLabel = `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`;

        await this.postModel.updateOne(
          { _id: fixture.campaignPostId },
          { $set: { lineupAvailable: true, fixtureId: fixtureIdStr } },
        );

        void this.notificationsService.notifyLineupAvailable({
          fixtureId: fixtureIdStr,
          matchLabel,
          postId: postIdStr,
        }).catch((err) => this.logger.error('Lineup notify failed', err));
      }

      // Stamp fixtureId on the post (idempotent)
      if (fixture.campaignPostId) {
        const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
        await this.postModel.updateOne(
          { _id: fixture.campaignPostId },
          { $set: { fixtureId: fixtureIdStr } },
        );
      }

      const result = {
        events: events.length,
        stats: stats.length,
        lineups: newLineupsCount,
        error: anyError ?? undefined,
      };
      this.logger.log(
        `Match details synced for ${externalId}: events=${result.events} stats=${result.stats} lineups=${result.lineups}${anyError ? ` (partial error: ${anyError})` : ''}`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Match details sync FAILED for fixture ${externalId}: ${message}`);
      return { events: 0, stats: 0, lineups: 0, error: message };
    }
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
      homeTeamExternalId: item.teams.home.id,
      awayTeamExternalId: item.teams.away.id,
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
   * Cron updater — refreshes dynamic fields (status / minute / score / kickoff)
   * for all WC fixtures, handles FINISHED transitions (set matchEndedAt /
   * winnerScheduledAt) and postponement kickoff changes.
   */
  async syncLiveScores(): Promise<number> {
    const items = await this.fetchLiveFixtures();
    this.logger.log(`syncLiveScores: API returned ${items.length} live fixture(s)`);
    for (const item of items) {
      this.logger.log(
        `  → fixture ${item.fixture.id}: ${item.teams.home.name} vs ${item.teams.away.name} | status=${item.fixture.status.short} elapsed=${item.fixture.status.elapsed} | score=${item.goals.home}-${item.goals.away}`,
      );
    }
    let updated = 0;

    for (const item of items) {
      const newStatus = normalizeStatus(item.fixture.status.short);
      const home = item.goals.home;
      const away = item.goals.away;
      const newKickoff = new Date(item.fixture.date);

      // Fetch the current stored fixture to detect transitions
      const existing = await this.fixtureModel
        .findOne({ externalId: item.fixture.id })
        .exec();

      if (!existing) {
        // Fixture not yet in local DB — skip campaign-post wiring but log so the
        // admin knows to run syncWorldCupFixtures to get the full record inserted.
        this.logger.warn(
          `syncLiveScores: fixture ${item.fixture.id} (${item.teams.home.name} vs ${item.teams.away.name}) not in DB — run syncWorldCupFixtures to import it`,
        );
        continue;
      }

      const wasFinished = existing.status === 'FINISHED';
      const kickoffChanged =
        existing.kickoff.getTime() !== newKickoff.getTime();

      const newMinute =
        newStatus === 'IN_PLAY' || newStatus === 'PAUSED'
          ? (item.fixture.status.elapsed ?? null)
          : null;

      await this.fixtureModel.updateOne(
        { externalId: item.fixture.id },
        {
          $set: {
            status: newStatus,
            kickoff: newKickoff,
            minute: newMinute,
            // Ensure team external IDs are always set (needed for event home/away assignment)
            homeTeamExternalId: item.teams.home.id,
            awayTeamExternalId: item.teams.away.id,
            score: {
              home,
              away,
              winner: deriveWinner(home, away, newStatus),
            },
          },
        },
      );

      // ── Live score changed: update denormalized fields on the campaign post ─
      if (existing.campaignPostId) {
        const prevHome = existing.score?.home ?? null;
        const prevAway = existing.score?.away ?? null;
        const prevStatus = existing.status;
        const prevMinute = existing.minute ?? null;

        const scoreChanged =
          prevHome !== home ||
          prevAway !== away ||
          prevStatus !== newStatus ||
          prevMinute !== newMinute;

        if (scoreChanged) {
          await this.postModel.updateOne(
            { _id: existing.campaignPostId },
            {
              $set: {
                fixtureScore: { home, away },
                fixtureStatus: newStatus,
                fixtureMinute: newMinute,
              },
            },
          );
          // Only push real-time update while the match is actively progressing
          // (not for every TIMED→TIMED no-op tick before kickoff).
          if (
            newStatus === 'IN_PLAY' ||
            newStatus === 'PAUSED' ||
            (prevStatus !== 'FINISHED' && newStatus === 'FINISHED')
          ) {
            await pubsub.publish(POST_UPDATED, {
              postUpdated: { postId: existing.campaignPostId.toHexString() },
            });
          }
        }
      }

      // ── Kickoff postponed: update the associated campaign post dates ──────
      if (
        kickoffChanged &&
        !wasFinished &&
        newStatus !== 'FINISHED' &&
        existing.campaignPostId
      ) {
        const newScheduledAt = new Date(
          newKickoff.getTime() - 24 * 60 * 60 * 1000,
        );
        await this.postModel.updateOne(
          { _id: existing.campaignPostId, status: PostStatus.SCHEDULED },
          { $set: { scheduledAt: newScheduledAt, votingEndsAt: newKickoff } },
        );
        // Reload fixture so we can re-use the fresh doc below
        this.logger.log(
          `Kickoff changed for ${existing.homeTeam.name} vs ${existing.awayTeam.name} — updated post dates`,
        );
        await pubsub.publish(POST_UPDATED, {
          postUpdated: { postId: existing.campaignPostId.toHexString() },
        });
      }

      // ── Sync match details (events/stats, lineups on first pass) ──────────
      // Throttled: run at most once per DETAIL_SYNC_INTERVAL per fixture while
      // live, or immediately on FINISHED transition (to capture final events).
      const needsDetailSync =
        newStatus === 'IN_PLAY' ||
        newStatus === 'PAUSED' ||
        (!wasFinished && newStatus === 'FINISHED');
      if (needsDetailSync && this.apiKey) {
        const exId = item.fixture.id;
        const lastSync = this.lastDetailSync.get(exId) ?? 0;
        const isFinishedNow = !wasFinished && newStatus === 'FINISHED';
        const due = isFinishedNow || (Date.now() - lastSync >= FixturesService.DETAIL_SYNC_INTERVAL);
        if (due) {
          this.lastDetailSync.set(exId, Date.now());
          const needsLineups = (existing.lineups?.length ?? 0) === 0;
          const fresh = await this.fixtureModel.findOne({ externalId: exId }).exec();
          if (fresh) void this.syncMatchDetails(fresh, needsLineups);
        }
      }

      // ── FINISHED transition: record matchEndedAt + schedule winner reveal ─
      if (!wasFinished && newStatus === 'FINISHED' && existing.campaignPostId) {
        const matchEndedAt = new Date();
        const post = await this.postModel
          .findById(existing.campaignPostId)
          .exec();
        const leadMin = post?.endingSoonLeadMinutes ?? 5;
        const winnerScheduledAt = new Date(
          matchEndedAt.getTime() + leadMin * 60 * 1000,
        );
        await this.fixtureModel.updateOne(
          { _id: existing._id },
          { $set: { matchEndedAt, winnerScheduledAt } },
        );
        await this.postModel.updateOne(
          { _id: existing.campaignPostId },
          { $set: { fixtureWinnerAt: winnerScheduledAt } },
        );
        this.logger.log(
          `Match finished: ${existing.homeTeam.name} vs ${existing.awayTeam.name}. Winner reveal at ${winnerScheduledAt.toISOString()}`,
        );
        if (post) {
          await pubsub.publish(POST_UPDATED, {
            postUpdated: { postId: post._id.toHexString() },
          });
        }
      }

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
    // 90 min ahead so the cron catches lineups as soon as the football API
    // publishes them (typically ~60 min before kickoff).
    const soon = new Date(now + 90 * 60 * 1000);
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
    if (!this.apiKey && !this.rapidApiKey) return null;
    if (!(await this.hasActiveWindow())) return null;
    return this.syncLiveScores();
  }

  /**
   * Reconcile posts for fixtures that are FINISHED in the DB but whose campaign
   * posts still have stale fixtureStatus. This catches matches that ended while
   * the live-only endpoint was not returning them (e.g. finished just before a
   * cron tick, or the server restarted mid-match).
   *
   * Runs on every cron tick — pure DB work, no external API calls.
   */
  async reconcileFinishedPosts(): Promise<void> {
    const stale = await this.fixtureModel
      .find({
        status: 'FINISHED',
        campaignPostId: { $exists: true, $ne: null },
        $or: [{ matchEndedAt: null }, { winnerScheduledAt: null }],
      })
      .exec();

    for (const fixture of stale) {
      try {
        const now = new Date();
        const matchEndedAt = fixture.matchEndedAt ?? now;
        const post = await this.postModel.findById(fixture.campaignPostId).exec();
        const leadMin = post?.endingSoonLeadMinutes ?? 5;
        // Schedule winner reveal immediately for already-past matches
        const winnerScheduledAt = new Date(
          Math.min(matchEndedAt.getTime() + leadMin * 60 * 1000, now.getTime()),
        );

        await this.fixtureModel.updateOne(
          { _id: fixture._id },
          { $set: { matchEndedAt, winnerScheduledAt } },
        );

        await this.postModel.updateOne(
          { _id: fixture.campaignPostId },
          {
            $set: {
              fixtureScore: {
                home: fixture.score?.home ?? null,
                away: fixture.score?.away ?? null,
              },
              fixtureStatus: 'FINISHED',
              fixtureMinute: null,
              fixtureWinnerAt: winnerScheduledAt,
            },
          },
        );

        await pubsub.publish(POST_UPDATED, {
          postUpdated: { postId: (fixture.campaignPostId as Types.ObjectId).toHexString() },
        });

        this.logger.log(
          `Reconciled finished fixture: ${fixture.homeTeam.name} vs ${fixture.awayTeam.name} — winner reveal at ${winnerScheduledAt.toISOString()}`,
        );
      } catch (err) {
        this.logger.error(
          `reconcileFinishedPosts: failed for fixture ${fixture._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async syncAllFinishedFixtures(): Promise<{ synced: number; skipped: number; errors: number }> {
    const fixtures = await this.fixtureModel
      .find({ status: 'FINISHED' })
      .exec();

    // Stamp fixtureId + lineupAvailable on every finished fixture's campaign post (idempotent)
    for (const fixture of fixtures) {
      if (!fixture.campaignPostId) continue;
      const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
      const hasLineups = Array.isArray(fixture.lineups) && fixture.lineups.length > 0;
      await this.postModel.updateOne(
        { _id: fixture.campaignPostId },
        { $set: { fixtureId: fixtureIdStr, lineupAvailable: hasLineups } },
      );
    }

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const fixture of fixtures) {
      // Skip only if all three data sets are already populated
      if (
        Array.isArray(fixture.events) && fixture.events.length > 0 &&
        Array.isArray(fixture.stats) && fixture.stats.length > 0 &&
        Array.isArray(fixture.playerRatings) && fixture.playerRatings.length > 0
      ) {
        skipped++;
        continue;
      }
      try {
        const result = await this.syncMatchDetails(fixture, true);
        if (result.events > 0 || result.stats > 0 || result.lineups > 0) {
          synced++;
        } else {
          errors++;
        }
        // Small delay between calls to respect rate limits
        await new Promise((r) => setTimeout(r, 600));
      } catch (e) {
        this.logger.error(`Failed to sync fixture ${fixture.externalId}: ${String(e)}`);
        errors++;
      }
    }

    this.logger.log(`Bulk sync complete: ${synced} synced, ${skipped} skipped (already had data), ${errors} errors`);
    return { synced, skipped, errors };
  }

  /**
   * Force-send the lineup-available notification for a fixture regardless of
   * whether lineups "just arrived" this tick. Use from admin mutation when the
   * automatic notification was missed (e.g. cron window was too narrow).
   */
  async sendLineupNotification(fixtureId: string): Promise<{ sent: number; error?: string }> {
    const fixture = await this.findById(fixtureId);
    if (!fixture) return { sent: 0, error: 'Fixture not found' };

    const hasLineups = Array.isArray(fixture.lineups) && fixture.lineups.length > 0;
    if (!hasLineups) {
      // No lineups in DB yet — attempt a live sync first, then re-check
      await this.syncMatchDetails(fixture, true).catch(() => {});
      const refreshed = await this.findById(fixtureId);
      const stillNone = !Array.isArray(refreshed?.lineups) || !refreshed!.lineups.length;
      if (stillNone) return { sent: 0, error: 'Lineups not yet available from the API' };
    }

    const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
    const matchLabel = `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`;
    const postId = fixture.campaignPostId?.toHexString() ?? null;

    const sent = await this.notificationsService.notifyLineupAvailable({
      fixtureId: fixtureIdStr,
      matchLabel,
      postId,
    });
    return { sent };
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
    opts: { autoScheduled?: boolean } = {},
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

    const home = fixture.homeTeam;
    const away = fixture.awayTeam;
    const isGroupStage = fixture.stage === 'GROUP_STAGE';
    const drawImageUrl =
      this.configService.get<string>('DRAW_OPTION_IMAGE_URL') ?? '';

    const options: { label: string; imageUrl?: string }[] = [
      { label: home.name, imageUrl: home.crest || undefined },
      { label: away.name, imageUrl: away.crest || undefined },
    ];
    if (isGroupStage) {
      options.push({ label: 'Draw 🤝', imageUrl: drawImageUrl || undefined });
    }

    const caption = generateMatchCaption({
      home: home.name,
      away: away.name,
      stage: fixture.stage,
      group: fixture.group,
      kickoff,
    });

    // Look up the world-cup campaign so the post is tagged to it
    const campaign = await this.campaignsService.findBySlug('world-cup-2026');

    const post = await this.postModel.create({
      type: PostType.SYSTEM,
      format: PostFormat.POLL,
      contentText: caption,
      imageUrls: [],
      options,
      categoryId: sportsCategory._id,
      campaignId: campaign ? campaign._id : undefined,
      visibility: Visibility.PUBLIC,
      createdBy: new Types.ObjectId(adminId),
      feedPriority: 100,
      voteCount: 0,
      commentsDisabled: false,
      likesDisabled: false,
      votingEndsAt: kickoff,
      endingSoonLeadMinutes: 5,
      status,
      scheduledAt,
      matchType: true,
    });

    fixture.campaignPostId = post._id as Types.ObjectId;
    fixture.autoScheduled = !!opts.autoScheduled;
    fixture.hasDrawOption = isGroupStage;
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
      autoScheduled: fixture.autoScheduled ?? false,
      hasDrawOption: fixture.hasDrawOption ?? false,
      matchEndedAt: fixture.matchEndedAt ?? null,
      winnerScheduledAt: fixture.winnerScheduledAt ?? null,
      events: fixture.events ?? [],
      lineups: fixture.lineups ?? [],
      stats: fixture.stats ?? [],
      playerRatings: fixture.playerRatings ?? [],
      detailsSyncedAt: fixture.detailsSyncedAt ?? null,
    };
  }
}
