import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Fixture, FixtureDocument, MatchEvent } from './fixture.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { Category, CategoryDocument } from '../categories/category.schema';
import {
  FixtureFilterInput,
  FixtureGql,
  TopAssistantGql,
  TopScorerGql,
} from './graphql/fixture.types';
import { PostFormat, PostStatus, PostType, Visibility } from '../common/enums';
import { PostsService } from '../posts/posts.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { NotificationsService } from '../notifications/notifications.service';
import { generateMatchCaption } from './caption-templates';
import {
  POST_UPDATED,
  POST_VOTE_UPDATED,
  MATCH_PREDICTION_UPDATED,
  pubsub,
} from '../pubsub';
import { MatchPredictionsService } from '../match-predictions/match-predictions.service';
import {
  buildFixtureScoreSet,
  buildPostFixtureScoreSet,
  denormalizedPostFieldsFromFixture,
  parseFixtureScores,
} from './fixture-score.util';

// ── API-Football ──────────────────────────────────────────────────────────
// Supports both direct api-sports.io and RapidAPI hosting.
// Set API_FOOTBALL_PROVIDER=rapidapi in .env to use RapidAPI (recommended —
// free tier includes events/lineups/statistics; direct api-sports.io requires
// a higher plan for those endpoints).
const AF_BASE_DIRECT = 'https://v3.football.api-sports.io';
const AF_BASE_RAPID = 'https://api-football-v1.p.rapidapi.com/v3';

/**
 * Manual coach corrections, keyed by team external id. API-Football sometimes
 * returns a placeholder coach ({ id: 0, name: null }) or an outdated name; this
 * fills in the real manager where we know it. Add entries as needed.
 */
const COACH_NAME_OVERRIDES: Record<number, string> = {
  4673: 'D. Bazeley', // New Zealand — API returns a null-name placeholder
};

/**
 * Resolve a lineup coach: prefer the API's value when it has a name, otherwise
 * fall back to a manual override for that team, otherwise null.
 */
function resolveLineupCoach(
  teamExternalId: number | undefined | null,
  coach:
    | { id?: number | null; name?: string | null; photo?: string | null }
    | null
    | undefined,
): { id: number | null; name: string; photo: string | null } | null {
  if (coach && coach.name) {
    return {
      id: coach.id ?? null,
      name: coach.name,
      photo: coach.photo ?? null,
    };
  }
  const override =
    teamExternalId != null ? COACH_NAME_OVERRIDES[teamExternalId] : undefined;
  if (override) {
    return { id: coach?.id ?? null, name: override, photo: null };
  }
  return null;
}

interface AfTeam {
  id: number;
  name: string;
  logo: string;
  winner?: boolean | null;
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
  score?: {
    fulltime?: { home: number | null; away: number | null } | null;
    extratime?: { home: number | null; away: number | null } | null;
    penalty?: { home: number | null; away: number | null } | null;
  };
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
interface AfPlayerStatLine {
  games?: {
    rating?: string | null;
    minutes?: number | null;
    number?: number | null;
    position?: string | null;
    captain?: boolean | null;
    substitute?: boolean | null;
  } | null;
  offsides?: number | null;
  shots?: { total?: number | null; on?: number | null } | null;
  goals?: {
    total?: number | null;
    conceded?: number | null;
    assists?: number | null;
    saves?: number | null;
  } | null;
  passes?: {
    total?: number | null;
    key?: number | null;
    accuracy?: number | string | null;
  } | null;
  tackles?: {
    total?: number | null;
    blocks?: number | null;
    interceptions?: number | null;
  } | null;
  duels?: { total?: number | null; won?: number | null } | null;
  dribbles?: {
    attempts?: number | null;
    success?: number | null;
    past?: number | null;
  } | null;
  fouls?: { drawn?: number | null; committed?: number | null } | null;
  cards?: { yellow?: number | null; red?: number | null } | null;
  penalty?: {
    won?: number | null;
    committed?: number | null;
    scored?: number | null;
    missed?: number | null;
    saved?: number | null;
  } | null;
}
interface AfPlayerStatEntry {
  player: { id: number; name: string; photo: string };
  statistics: AfPlayerStatLine[];
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

/** "Group Stage - 2" → 2; knockout rounds → null unless a match index is present. */
function parseMatchday(round: string): number | null {
  const r = (round ?? '').trim();
  const groupM = /group\s+stage\s*-\s*(\d+)/i.exec(r);
  if (groupM) return Number(groupM[1]);
  // "Round of 32" / "Round of 16" must NOT become 32/16 — only explicit indexes count.
  if (/^round\s+of\s+\d+\s*$/i.test(r)) return null;
  const dashM = /-\s*(\d+)\s*$/.exec(r);
  if (dashM) return Number(dashM[1]);
  return null;
}

/** API-Football round string → the app's stage vocabulary. */
function mapStage(round: string): string {
  const r = (round ?? '').toLowerCase();
  if (r.includes('group')) return 'GROUP_STAGE';
  if (r.includes('32')) return 'LAST_32';
  if (r.includes('16')) return 'LAST_16';
  if (r.includes('quarter')) return 'QUARTER_FINALS';
  if (r.includes('semi')) return 'SEMI_FINALS';
  if (r.includes('3rd') || r.includes('third')) return 'THIRD_PLACE';
  if (r.includes('final')) return 'FINAL';
  return 'GROUP_STAGE';
}

/** "Group A" → "GROUP_A". Requires a standalone letter so "Group Stage" doesn't match as "GROUP_S". */
function normalizeGroup(g?: string | null): string | null {
  if (!g) return null;
  const m = /group\s+([a-z])\b/i.exec(g);
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

/**
 * Canonicalize a stored winner value. Older fixtures saved 'home'/'away'/'draw';
 * deriveWinner now emits 'HOME_TEAM'/'AWAY_TEAM'/'DRAW'. Map both to the latter
 * so all clients can rely on a single format.
 */
/** Campaign match posts go live this long before kickoff (voting ends at kickoff). */
export const WC_MATCH_POST_LEAD_MS = 24 * 60 * 60 * 1000;

function matchPostGoLiveAt(kickoff: Date): Date {
  return new Date(kickoff.getTime() - WC_MATCH_POST_LEAD_MS);
}

function normalizeWinner(winner?: string | null): string | null {
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

@Injectable()
export class FixturesService implements OnModuleInit {
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
  /** Tracks last ghost-IN_PLAY individual-fixture check timestamp per externalId. */
  private readonly lastGhostCheck = new Map<number, number>();
  /** Throttles the low-quota warning log so a sustained low period doesn't spam. */
  private lastQuotaWarnAt = 0;
  private static readonly QUOTA_WARN_THRESHOLD = 0.2; // warn at ≤20% of the period's requests remaining
  private static readonly QUOTA_WARN_INTERVAL_MS = 10 * 60 * 1000; // at most once per 10 min

  constructor(
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private configService: ConfigService,
    private postsService: PostsService,
    private campaignsService: CampaignsService,
    private notificationsService: NotificationsService,
    private matchPredictionsService: MatchPredictionsService,
  ) {
    this.apiKey = this.configService.get<string>('API_FOOTBALL_KEY') ?? '';
    this.rapidApiKey =
      this.configService.get<string>('RAPID_API_FOOTBALL_KEY') ?? '';
    this.useRapidApi =
      !!this.rapidApiKey ||
      this.configService.get<string>('API_FOOTBALL_PROVIDER') === 'rapidapi';
    this.league =
      this.configService.get<string>('API_FOOTBALL_WC_LEAGUE') ?? '1';
    this.season =
      this.configService.get<string>('API_FOOTBALL_WC_SEASON') ?? '2026';
    this.logger.log(
      `API-Football provider: ${this.useRapidApi ? 'RapidAPI' : 'api-sports.io (direct)'}`,
    );
  }

  /** One-time denormalisation for posts created before fixtureStage/hasDrawOption existed. */
  onModuleInit(): void {
    void this.backfillPostFixtureMeta().catch((err) =>
      this.logger.warn(
        `Post fixture meta backfill skipped: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  private async backfillPostFixtureMeta(): Promise<void> {
    const fixtures = await this.fixtureModel
      .find({ campaignPostId: { $exists: true, $ne: null } })
      .select({ campaignPostId: 1, stage: 1, hasDrawOption: 1 })
      .exec();
    if (fixtures.length === 0) return;
    await Promise.all(
      fixtures.map((fixture) =>
        this.postModel.updateOne(
          { _id: fixture.campaignPostId },
          {
            $set: {
              fixtureStage: fixture.stage,
              hasDrawOption:
                fixture.hasDrawOption ?? fixture.stage === 'GROUP_STAGE',
              fixtureId: (fixture._id as Types.ObjectId).toHexString(),
            },
          },
        ),
      ),
    );
    this.logger.log(
      `Backfilled fixtureStage/hasDrawOption on ${fixtures.length} match posts`,
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
    this.logger.debug(
      `API-Football → ${url} (key: ${key ? key.slice(0, 6) + '…' : 'MISSING'})`,
    );
    const res = await fetch(url, { headers });
    this.logQuotaIfLow(res.headers);
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

  /**
   * Logs a warning once remaining API-Football requests for the current
   * period drop to QUOTA_WARN_THRESHOLD or below, so a quota exhaustion is
   * caught in logs before it silently breaks live-match syncing.
   */
  private logQuotaIfLow(headers: Headers): void {
    const limit = Number(headers.get('x-ratelimit-requests-limit'));
    const remaining = Number(headers.get('x-ratelimit-requests-remaining'));
    if (!limit || Number.isNaN(remaining)) return;
    if (remaining / limit > FixturesService.QUOTA_WARN_THRESHOLD) return;
    const now = Date.now();
    if (now - this.lastQuotaWarnAt < FixturesService.QUOTA_WARN_INTERVAL_MS) {
      return;
    }
    this.lastQuotaWarnAt = now;
    this.logger.warn(
      `API-Football quota running low: ${remaining}/${limit} requests remaining`,
    );
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

  /** Count scored goals from stored events (handles own goals). */
  private countGoalsFromEvents(events: MatchEvent[] | undefined | null): {
    home: number;
    away: number;
  } {
    let home = 0;
    let away = 0;
    for (const e of events ?? []) {
      if (e.type !== 'Goal') continue;
      const d = (e.detail ?? '').toLowerCase();
      if (
        d.includes('disallow') ||
        d.includes('missed') ||
        d.includes('shootout')
      ) {
        continue;
      }
      if (d.includes('own goal')) {
        if (e.team === 'home') away++;
        else home++;
      } else if (e.team === 'home') {
        home++;
      } else {
        away++;
      }
    }
    return { home, away };
  }

  /** True when events, stats, and player ratings are all already populated. */
  private hasCompleteFixtureData(fixture: FixtureDocument): boolean {
    return (
      Array.isArray(fixture.events) &&
      fixture.events.length > 0 &&
      Array.isArray(fixture.stats) &&
      fixture.stats.length > 0 &&
      Array.isArray(fixture.playerRatings) &&
      fixture.playerRatings.length > 0
    );
  }

  /** True when API score has more goals than our stored events (stale sync). */
  private eventsMismatchScore(fixture: FixtureDocument): boolean {
    const scoreHome = fixture.score?.home;
    const scoreAway = fixture.score?.away;
    if (scoreHome == null || scoreAway == null) return false;
    const { home, away } = this.countGoalsFromEvents(fixture.events);
    return home !== scoreHome || away !== scoreAway;
  }

  /** Stop re-syncing a finished fixture's events/stats after this long — a
   * mismatch that hasn't resolved by then is a permanent data quirk (e.g. a
   * VAR overturn or own-goal misattribution the API itself never corrects),
   * not something more polling will fix. Without this cap, one such fixture
   * would burn ~4 API calls every 5 minutes forever. */
  private static readonly EVENT_RECONCILE_GIVE_UP_MS = 6 * 60 * 60 * 1000;

  /**
   * Re-fetch events/stats for FINISHED fixtures whose event count doesn't
   * match the final score (e.g. stoppage-time goals added after first sync).
   * Gives up on a fixture once it's been over for EVENT_RECONCILE_GIVE_UP_MS.
   */
  async reconcileIncompleteMatchEvents(): Promise<number> {
    const cutoff = new Date(
      Date.now() - FixturesService.EVENT_RECONCILE_GIVE_UP_MS,
    );
    const fixtures = await this.fixtureModel
      .find({
        status: 'FINISHED',
        'score.home': { $ne: null },
        'score.away': { $ne: null },
        matchEndedAt: { $gte: cutoff },
      })
      .exec();

    let synced = 0;
    for (const fixture of fixtures) {
      if (!this.eventsMismatchScore(fixture)) continue;
      try {
        this.logger.log(
          `Re-syncing stale events for ${fixture.homeTeam.name} vs ${fixture.awayTeam.name} (score ${fixture.score?.home}-${fixture.score?.away}, events=${fixture.events?.length ?? 0})`,
        );
        await this.syncMatchDetails(fixture, false);
        synced++;
        await new Promise((r) => setTimeout(r, 600));
      } catch (err) {
        this.logger.error(
          `reconcileIncompleteMatchEvents: failed for ${fixture.externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (synced > 0) {
      this.logger.log(`Re-synced events for ${synced} finished fixture(s)`);
    }
    return synced;
  }

  async syncMatchDetails(
    fixture: FixtureDocument,
    includeLineups = true,
  ): Promise<{
    events: number;
    stats: number;
    lineups: number;
    error?: string;
  }> {
    const externalId = fixture.externalId;
    this.logger.log(
      `Syncing match details for fixture ${externalId} (${fixture.homeTeam.name} vs ${fixture.awayTeam.name})`,
    );
    try {
      const [eventsResult, statsResult, lineupsResult, ratingsResult] =
        await Promise.allSettled([
          this.fetchMatchEvents(externalId),
          this.fetchMatchStats(externalId),
          includeLineups
            ? this.fetchMatchLineups(externalId)
            : Promise.resolve(null),
          this.fetchPlayerRatings(externalId),
        ]);

      if (eventsResult.status === 'rejected')
        this.logger.error(
          `Events fetch failed: ${String(eventsResult.reason)}`,
        );
      if (statsResult.status === 'rejected')
        this.logger.error(`Stats fetch failed: ${String(statsResult.reason)}`);
      if (lineupsResult.status === 'rejected')
        this.logger.error(
          `Lineups fetch failed: ${String(lineupsResult.reason)}`,
        );
      if (ratingsResult.status === 'rejected')
        this.logger.error(
          `Ratings fetch failed: ${String(ratingsResult.reason)}`,
        );

      const eventsRaw =
        eventsResult.status === 'fulfilled' ? eventsResult.value : [];
      const statsRaw =
        statsResult.status === 'fulfilled' ? statsResult.value : null;
      const lineupsRaw =
        lineupsResult.status === 'fulfilled' ? lineupsResult.value : null;
      const ratingsRaw =
        ratingsResult.status === 'fulfilled' ? ratingsResult.value : null;

      const anyError =
        (eventsResult.status === 'rejected'
          ? String(eventsResult.reason)
          : null) ??
        (statsResult.status === 'rejected'
          ? String(statsResult.reason)
          : null) ??
        (lineupsResult.status === 'rejected'
          ? String(lineupsResult.reason)
          : null) ??
        (ratingsResult.status === 'rejected'
          ? String(ratingsResult.reason)
          : null);

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

      const teamSideOf = (teamData: AfPlayerStatTeam) =>
        teamData.team.id === homeId ||
        teamData.team.name === fixture.homeTeam.name
          ? 'home'
          : 'away';

      const playerRatings = (ratingsRaw ?? []).flatMap((teamData) => {
        const teamSide = teamSideOf(teamData);
        return (teamData.players ?? [])
          .filter((p) => p.statistics?.[0]?.games?.rating != null)
          .map((p) => ({
            playerId: p.player.id,
            name: p.player.name,
            team: teamSide,
            rating: p.statistics[0].games?.rating ?? null,
            photo:
              p.player.photo ??
              `https://media.api-sports.io/football/players/${p.player.id}.png`,
          }));
      });

      const toNum = (v: number | string | null | undefined): number | null => {
        if (v == null) return null;
        const n = typeof v === 'string' ? parseInt(v, 10) : v;
        return Number.isFinite(n) ? n : null;
      };

      // Full per-player stat lines for the player match card.
      const playerMatchStats = (ratingsRaw ?? []).flatMap((teamData) => {
        const teamSide = teamSideOf(teamData);
        return (teamData.players ?? []).map((p) => {
          const s = p.statistics?.[0] ?? {};
          return {
            playerId: p.player.id,
            name: p.player.name,
            team: teamSide,
            photo:
              p.player.photo ??
              `https://media.api-sports.io/football/players/${p.player.id}.png`,
            number: s.games?.number ?? null,
            position: s.games?.position ?? null,
            minutes: s.games?.minutes ?? null,
            rating: s.games?.rating ?? null,
            captain: s.games?.captain ?? null,
            substitute: s.games?.substitute ?? null,
            goals: s.goals?.total ?? null,
            assists: s.goals?.assists ?? null,
            saves: s.goals?.saves ?? null,
            shotsTotal: s.shots?.total ?? null,
            shotsOn: s.shots?.on ?? null,
            keyPasses: s.passes?.key ?? null,
            passesTotal: s.passes?.total ?? null,
            // API-Football's passes.accuracy is the COUNT of accurate passes,
            // not a percentage — convert it to a % of total passes.
            passAccuracy: (() => {
              const acc = toNum(s.passes?.accuracy);
              const tot = s.passes?.total ?? null;
              return acc != null && tot != null && tot > 0
                ? Math.round((acc / tot) * 100)
                : null;
            })(),
            dribblesAttempts: s.dribbles?.attempts ?? null,
            dribblesSuccess: s.dribbles?.success ?? null,
            foulsDrawn: s.fouls?.drawn ?? null,
            foulsCommitted: s.fouls?.committed ?? null,
            tacklesTotal: s.tackles?.total ?? null,
            interceptions: s.tackles?.interceptions ?? null,
            duelsTotal: s.duels?.total ?? null,
            duelsWon: s.duels?.won ?? null,
            offsides: s.offsides ?? null,
            yellow: s.cards?.yellow ?? null,
            red: s.cards?.red ?? null,
            penaltyScored: s.penalty?.scored ?? null,
            penaltyMissed: s.penalty?.missed ?? null,
          };
        });
      });

      const update: Record<string, unknown> = {
        events,
        stats,
        playerRatings,
        playerMatchStats,
        detailsSyncedAt: new Date(),
      };

      const hadLineups =
        Array.isArray(fixture.lineups) && fixture.lineups.length > 0;
      let newLineupsCount = 0;

      if (lineupsRaw != null && lineupsRaw.length > 0) {
        const lineups = lineupsRaw.map((l) => ({
          team:
            l.team.id === homeId || l.team.name === fixture.homeTeam.name
              ? 'home'
              : 'away',
          formation: l.formation,
          startXI: l.startXI.map((p) => ({
            id: p.player.id ?? null,
            name: p.player.name,
            number: p.player.number,
            pos: p.player.pos ?? null,
            grid: p.player.grid ?? null,
            photo:
              p.player.photo ??
              (p.player.id
                ? `https://media.api-sports.io/football/players/${p.player.id}.png`
                : null),
          })),
          substitutes: l.substitutes.map((p) => ({
            id: p.player.id ?? null,
            name: p.player.name,
            number: p.player.number,
            pos: p.player.pos ?? null,
            grid: p.player.grid ?? null,
            photo:
              p.player.photo ??
              (p.player.id
                ? `https://media.api-sports.io/football/players/${p.player.id}.png`
                : null),
          })),
          coach: resolveLineupCoach(l.team?.id, l.coach),
        }));
        update.lineups = lineups;
        newLineupsCount = lineups.length;
      }

      await this.fixtureModel.updateOne({ _id: fixture._id }, { $set: update });

      // When lineups are newly available, update the linked post and notify all users
      const lineupsJustArrived = !hadLineups && newLineupsCount > 0;
      if (lineupsJustArrived && fixture.campaignPostId) {
        const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
        const postIdStr = fixture.campaignPostId.toHexString();
        const matchLabel = `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`;

        await this.postModel.updateOne(
          { _id: fixture.campaignPostId },
          {
            $set: {
              lineupAvailable: true,
              fixtureId: fixtureIdStr,
              fixtureStage: fixture.stage,
              hasDrawOption:
                fixture.hasDrawOption ?? fixture.stage === 'GROUP_STAGE',
            },
          },
        );

        void this.notificationsService
          .notifyLineupAvailable({
            fixtureId: fixtureIdStr,
            matchLabel,
            postId: postIdStr,
          })
          .catch((err) => this.logger.error('Lineup notify failed', err));
      }

      // Stamp fixtureId on the post (idempotent)
      if (fixture.campaignPostId) {
        const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
        await this.postModel.updateOne(
          { _id: fixture.campaignPostId },
          {
            $set: {
              fixtureId: fixtureIdStr,
              fixtureStage: fixture.stage,
              hasDrawOption:
                fixture.hasDrawOption ?? fixture.stage === 'GROUP_STAGE',
            },
          },
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
      this.logger.error(
        `Match details sync FAILED for fixture ${externalId}: ${message}`,
      );
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
    const parsed = parseFixtureScores(item, status);
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
      ...buildFixtureScoreSet(parsed),
      ...(venue?.name
        ? { venue: { name: venue.name, city: venue.city ?? '' } }
        : {}),
    };
  }

  private buildPostScoreUpdate(
    parsed: ReturnType<typeof parseFixtureScores>,
    fixture: Pick<FixtureDocument, 'stage' | 'hasDrawOption'>,
    status: string,
    minute: number | null,
  ) {
    return {
      ...buildPostFixtureScoreSet(parsed),
      fixtureStatus: status,
      fixtureMinute: minute,
      fixtureStage: fixture.stage,
      hasDrawOption: fixture.hasDrawOption ?? fixture.stage === 'GROUP_STAGE',
    };
  }

  /**
   * Copy fixture live fields onto the linked campaign post when they diverge.
   * Compares the post document to the fixture row (not a prior fixture snapshot),
   * so minute ticks still propagate when the fixture collection updated first.
   */
  private async syncCampaignPostFromFixture(
    fixture: FixtureDocument,
    opts: { publish?: boolean } = {},
  ): Promise<boolean> {
    const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
    const fields = denormalizedPostFieldsFromFixture(fixture);

    // Resolve every campaign post tied to this fixture. The canonical link is
    // fixture.campaignPostId, but after a post recreate/migrate the feed post
    // may only have post.fixtureId set while campaignPostId still points at a
    // deleted row — then live minute/score never reaches the visible card.
    const targetIds = new Set<string>();
    if (fixture.campaignPostId) {
      targetIds.add((fixture.campaignPostId as Types.ObjectId).toHexString());
    }
    const postsByFixture = await this.postModel
      .find({ matchType: true, fixtureId: fixtureIdStr })
      .select('_id')
      .exec();
    for (const row of postsByFixture) {
      targetIds.add((row._id as Types.ObjectId).toHexString());
    }

    let anyUpdated = false;
    let canonicalPostId: Types.ObjectId | null = null;

    for (const postIdStr of targetIds) {
      const postId = new Types.ObjectId(postIdStr);
      const post = await this.postModel.findById(postId).exec();
      if (!post) continue;
      canonicalPostId = postId;

      const fs = fields.fixtureScore;
      const stale =
        post.fixtureStatus !== fields.fixtureStatus ||
        (post.fixtureMinute ?? null) !== fields.fixtureMinute ||
        (post.fixtureScore?.home ?? null) !== fs.home ||
        (post.fixtureScore?.away ?? null) !== fs.away ||
        (post.fixtureScore?.phase ?? null) !== fs.phase;

      if (!stale) continue;

      await this.postModel.updateOne({ _id: postId }, { $set: fields });
      anyUpdated = true;

      const shouldPublish = opts.publish !== false;
      const status = fixture.status;
      if (
        shouldPublish &&
        (status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED')
      ) {
        await pubsub.publish(POST_VOTE_UPDATED, {
          postVoteUpdated: { postId: postIdStr },
        });
        await pubsub.publish(POST_UPDATED, {
          postUpdated: { postId: postIdStr },
        });
      }
    }

    // Repair stale fixture.campaignPostId when it references a missing post.
    if (canonicalPostId) {
      const current = fixture.campaignPostId as Types.ObjectId | undefined;
      const currentMissing =
        !current || !(await this.postModel.exists({ _id: current }).exec());
      if (
        currentMissing ||
        current!.toHexString() !== canonicalPostId.toHexString()
      ) {
        await this.fixtureModel.updateOne(
          { _id: fixture._id },
          { $set: { campaignPostId: canonicalPostId } },
        );
        this.logger.warn(
          `Repaired fixture.campaignPostId for ${fixture.homeTeam.name} vs ${fixture.awayTeam.name} → ${canonicalPostId.toHexString()}`,
        );
      }
    }

    return anyUpdated;
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
   * Keep scheduled match posts aligned with fixture kickoff (e.g. after full API sync).
   * Publish time is always kickoff − 24 h; voting closes at kickoff.
   */
  async reconcileScheduledMatchPostDates(): Promise<number> {
    const fixtures = await this.fixtureModel
      .find({ campaignPostId: { $exists: true } })
      .select({ kickoff: 1, campaignPostId: 1, homeTeam: 1, awayTeam: 1 })
      .exec();

    let updated = 0;
    for (const fixture of fixtures) {
      const post = await this.postModel
        .findOne({
          _id: fixture.campaignPostId,
          status: PostStatus.SCHEDULED,
          matchType: true,
        })
        .select({ scheduledAt: 1, votingEndsAt: 1 })
        .exec();
      if (!post) continue;

      const goLiveAt = matchPostGoLiveAt(fixture.kickoff);
      const scheduledMs = post.scheduledAt?.getTime();
      const votingMs = post.votingEndsAt?.getTime();
      const kickoffMs = fixture.kickoff.getTime();
      if (scheduledMs === goLiveAt.getTime() && votingMs === kickoffMs) {
        continue;
      }

      await this.postModel.updateOne(
        { _id: post._id },
        { $set: { scheduledAt: goLiveAt, votingEndsAt: fixture.kickoff } },
      );
      updated++;
      this.logger.log(
        `Aligned scheduled post for ${fixture.homeTeam.name} vs ${fixture.awayTeam.name} → publish ${goLiveAt.toISOString()}`,
      );
    }
    return updated;
  }

  /**
   * Cron updater — refreshes dynamic fields (status / minute / score / kickoff)
   * for all WC fixtures, handles FINISHED transitions (set matchEndedAt /
   * winnerScheduledAt) and postponement kickoff changes.
   */
  async syncLiveScores(): Promise<number> {
    const items = await this.fetchLiveFixtures();
    this.logger.log(
      `syncLiveScores: API returned ${items.length} live fixture(s)`,
    );
    for (const item of items) {
      this.logger.log(
        `  → fixture ${item.fixture.id}: ${item.teams.home.name} vs ${item.teams.away.name} | status=${item.fixture.status.short} elapsed=${item.fixture.status.elapsed} | score=${item.goals.home}-${item.goals.away}`,
      );
    }
    let updated = 0;

    for (const item of items) {
      const newStatus = normalizeStatus(item.fixture.status.short);
      const parsed = parseFixtureScores(item, newStatus);
      const { home, away } = parsed;
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
            kickoff: newKickoff,
            minute: newMinute,
            // Ensure team external IDs are always set (needed for event home/away assignment)
            homeTeamExternalId: item.teams.home.id,
            awayTeamExternalId: item.teams.away.id,
            ...buildFixtureScoreSet(parsed),
            status: newStatus,
          },
        },
      );

      // ── Match just finished: award correct-prediction coin bonuses ───────
      if (
        !wasFinished &&
        newStatus === 'FINISHED' &&
        existing.campaignPostId &&
        parsed.predictionScore
      ) {
        await this.matchPredictionsService.awardWinners(
          existing.campaignPostId.toHexString(),
          parsed.predictionScore.home,
          parsed.predictionScore.away,
        );
      }

      // ── Live score changed: mirror fixture row onto the campaign post ─────
      const refreshed = await this.fixtureModel
        .findOne({ externalId: item.fixture.id })
        .exec();
      if (refreshed) {
        await this.syncCampaignPostFromFixture(refreshed);
      }

      // ── Kickoff postponed: update the associated campaign post dates ──────
      if (
        kickoffChanged &&
        !wasFinished &&
        newStatus !== 'FINISHED' &&
        existing.campaignPostId
      ) {
        const newScheduledAt = matchPostGoLiveAt(newKickoff);
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
      // Throttled while live; on FINISHED transition; and for ~6 h after full
      // time so late-added stoppage goals get picked up from the API.
      const matchEndedAt =
        existing.matchEndedAt ??
        (!wasFinished && newStatus === 'FINISHED' ? new Date() : null);
      const recentlyFinished =
        newStatus === 'FINISHED' &&
        matchEndedAt != null &&
        Date.now() - matchEndedAt.getTime() < 6 * 60 * 60 * 1000;
      const needsDetailSync =
        newStatus === 'IN_PLAY' ||
        newStatus === 'PAUSED' ||
        (!wasFinished && newStatus === 'FINISHED') ||
        (newStatus === 'FINISHED' && recentlyFinished);
      if (needsDetailSync && this.apiKey) {
        const exId = item.fixture.id;
        const isFinishedNow = !wasFinished && newStatus === 'FINISHED';
        // Gate on the fixture's own persisted `detailsSyncedAt` (only set by
        // syncMatchDetails on a fully successful run) instead of the
        // in-memory `lastDetailSync` attempt map. That map used to be
        // touched the moment we DECIDED to sync, before the (fire-and-forget)
        // sync even ran — so a failed or slow attempt still marked the
        // fixture "recently synced" and silently blocked retries for a full
        // DETAIL_SYNC_INTERVAL. Reading the real DB state means a failure is
        // retried on the very next tick (30s later, not 3min), and the gate
        // survives process restarts instead of resetting to "unknown".
        const lastSyncedAt = existing.detailsSyncedAt?.getTime() ?? 0;
        const due =
          isFinishedNow ||
          Date.now() - lastSyncedAt >= FixturesService.DETAIL_SYNC_INTERVAL;
        if (due) {
          const needsLineups = (existing.lineups?.length ?? 0) === 0;
          const fresh = await this.fixtureModel
            .findOne({ externalId: exId })
            .exec();
          // Awaited (not fire-and-forget): errors are now visible to this
          // sync cycle and logged with fixture context instead of vanishing
          // into an unobserved rejected promise.
          if (fresh) {
            const result = await this.syncMatchDetails(fresh, needsLineups);
            if (result.error) {
              this.logger.warn(
                `Detail sync for fixture ${exId} failed — will retry next tick: ${result.error}`,
              );
            }
          }
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
          // Score-prediction winners resolve the instant the match is FINISHED
          // (status + final score). Nudge viewers to refetch now so the winners
          // show immediately at full-time, not when the +5min campaign reveal
          // (or a remount) happens to refresh the post.
          await pubsub.publish(MATCH_PREDICTION_UPDATED, {
            matchPredictionUpdated: { postId: post._id.toHexString() },
          });
        }
      }

      updated++;
    }
    // ── Ghost-IN_PLAY cleanup ────────────────────────────────────────────────
    // If a fixture is IN_PLAY/PAUSED in our DB but wasn't returned by the live
    // endpoint, the match has likely ended. Fetch it individually so we get its
    // final FINISHED status and score rather than leaving it stuck as "live".
    const liveExternalIds = new Set(items.map((i) => i.fixture.id));
    const ghosts = await this.fixtureModel
      .find({ status: { $in: ['IN_PLAY', 'PAUSED'] } })
      .exec();
    for (const ghost of ghosts) {
      if (liveExternalIds.has(ghost.externalId)) continue; // still live — handled above
      const lastGhostCheck = this.lastGhostCheck.get(ghost.externalId) ?? 0;
      if (Date.now() - lastGhostCheck < FixturesService.DETAIL_SYNC_INTERVAL) {
        continue;
      }
      this.lastGhostCheck.set(ghost.externalId, Date.now());
      // Fetch the individual fixture to get its current status
      try {
        const res = await this.apiFetch<AfFixtureItem[]>(
          `/fixtures?id=${ghost.externalId}`,
        );
        if (!res.length) continue;
        const item = res[0];
        const newStatus = normalizeStatus(item.fixture.status.short);
        const parsed = parseFixtureScores(item, newStatus);
        const { home, away } = parsed;
        this.logger.log(
          `Ghost IN_PLAY fixture ${ghost.externalId} (${ghost.homeTeam.name} vs ${ghost.awayTeam.name}): now ${newStatus} ${home}-${away}`,
        );
        await this.fixtureModel.updateOne(
          { _id: ghost._id },
          {
            $set: {
              minute: null,
              ...buildFixtureScoreSet(parsed),
              status: newStatus,
            },
          },
        );
        if (ghost.campaignPostId) {
          const postId = ghost.campaignPostId.toHexString();
          const postUpdate: Record<string, unknown> = this.buildPostScoreUpdate(
            parsed,
            ghost,
            newStatus,
            null,
          );

          // For FINISHED: compute winner reveal time and include it in the same
          // DB write so the pubsub publish always reads the complete final state.
          if (newStatus === 'FINISHED') {
            const matchEndedAt = new Date();
            const postDoc = await this.postModel
              .findById(ghost.campaignPostId)
              .exec();
            const leadMin = postDoc?.endingSoonLeadMinutes ?? 5;
            const winnerScheduledAt = new Date(
              matchEndedAt.getTime() + leadMin * 60 * 1000,
            );
            await this.fixtureModel.updateOne(
              { _id: ghost._id },
              { $set: { matchEndedAt, winnerScheduledAt } },
            );
            postUpdate.fixtureWinnerAt = winnerScheduledAt;
            if (parsed.predictionScore) {
              await this.matchPredictionsService.awardWinners(
                postId,
                parsed.predictionScore.home,
                parsed.predictionScore.away,
              );
            }
            this.logger.log(
              `Match finished (ghost cleanup): ${ghost.homeTeam.name} vs ${ghost.awayTeam.name}. Winner reveal at ${winnerScheduledAt.toISOString()}`,
            );
          }

          await this.postModel.updateOne(
            { _id: ghost.campaignPostId },
            { $set: postUpdate },
          );
          // Publish after all DB writes are done so the subscription resolver
          // reads the complete final state (including fixtureWinnerAt).
          await pubsub.publish(POST_UPDATED, { postUpdated: { postId } });
          await pubsub.publish(POST_VOTE_UPDATED, {
            postVoteUpdated: { postId },
          });
          if (newStatus === 'FINISHED') {
            // Refresh score-prediction winners immediately at full-time.
            await pubsub.publish(MATCH_PREDICTION_UPDATED, {
              matchPredictionUpdated: { postId },
            });
          }
        }
        if (newStatus === 'FINISHED' && this.apiKey) {
          const freshGhost = await this.fixtureModel
            .findOne({ externalId: ghost.externalId })
            .exec();
          if (freshGhost) {
            const needsLineups = (freshGhost.lineups?.length ?? 0) === 0;
            const result = await this.syncMatchDetails(
              freshGhost,
              needsLineups,
            );
            if (result.error) {
              this.logger.warn(
                `Ghost detail sync for fixture ${ghost.externalId} failed: ${result.error}`,
              );
            }
          }
        }
        updated++;
      } catch (err) {
        this.logger.warn(
          `Ghost cleanup failed for fixture ${ghost.externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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
   * Fetches lineups for SCHEDULED/TIMED fixtures kicking off within 70 minutes
   * that have no lineups yet. Runs on every active cron tick so lineups appear
   * pre-match as soon as the football API publishes them (~60 min before kickoff).
   * Uses the shared lastDetailSync throttle to avoid hammering the API.
   */
  async syncPreMatchLineups(): Promise<void> {
    if (!this.apiKey && !this.rapidApiKey) return;
    const now = Date.now();
    const soon = new Date(now + 70 * 60 * 1000);
    const fixtures = await this.fixtureModel
      .find({
        status: { $in: ['SCHEDULED', 'TIMED'] },
        kickoff: { $gte: new Date(now), $lte: soon },
        $or: [{ lineups: { $exists: false } }, { lineups: { $size: 0 } }],
      })
      .exec();

    for (const fixture of fixtures) {
      const exId = fixture.externalId;
      const lastSync = this.lastDetailSync.get(exId) ?? 0;
      if (Date.now() - lastSync < FixturesService.DETAIL_SYNC_INTERVAL)
        continue;
      this.lastDetailSync.set(exId, Date.now());
      const minsToKickoff = Math.round(
        (fixture.kickoff.getTime() - Date.now()) / 60000,
      );
      this.logger.log(
        `Pre-match lineup check for fixture ${exId} (${fixture.homeTeam.name} vs ${fixture.awayTeam.name}, kickoff in ${minsToKickoff} min)`,
      );
      try {
        const lineupsRaw = await this.fetchMatchLineups(exId);
        if (!lineupsRaw.length) {
          this.logger.log(`No lineups yet for fixture ${exId}`);
          continue;
        }
        const homeId = fixture.homeTeamExternalId;
        const lineups = lineupsRaw.map((l) => ({
          team:
            l.team.id === homeId || l.team.name === fixture.homeTeam.name
              ? 'home'
              : 'away',
          formation: l.formation,
          startXI: l.startXI.map((p) => ({
            id: p.player.id ?? null,
            name: p.player.name,
            number: p.player.number,
            pos: p.player.pos ?? null,
            grid: p.player.grid ?? null,
            photo:
              p.player.photo ??
              (p.player.id
                ? `https://media.api-sports.io/football/players/${p.player.id}.png`
                : null),
          })),
          substitutes: l.substitutes.map((p) => ({
            id: p.player.id ?? null,
            name: p.player.name,
            number: p.player.number,
            pos: p.player.pos ?? null,
            grid: p.player.grid ?? null,
            photo:
              p.player.photo ??
              (p.player.id
                ? `https://media.api-sports.io/football/players/${p.player.id}.png`
                : null),
          })),
          coach: resolveLineupCoach(l.team?.id, l.coach),
        }));
        await this.fixtureModel.updateOne(
          { _id: fixture._id },
          { $set: { lineups } },
        );
        this.logger.log(
          `Pre-match lineups saved for fixture ${exId}: ${lineups.length} team(s)`,
        );
        if (fixture.campaignPostId) {
          const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
          const postIdStr = fixture.campaignPostId.toHexString();
          const matchLabel = `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`;
          await this.postModel.updateOne(
            { _id: fixture.campaignPostId },
            { $set: { lineupAvailable: true, fixtureId: fixtureIdStr } },
          );
          void this.notificationsService
            .notifyLineupAvailable({
              fixtureId: fixtureIdStr,
              matchLabel,
              postId: postIdStr,
            })
            .catch((err) => this.logger.error('Lineup notify failed', err));
        }
      } catch (err) {
        this.logger.warn(
          `Pre-match lineup sync failed for ${exId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Cron entry point: refresh live scores only during live/imminent windows so
   * the API quota isn't wasted when nothing is on. Returns the number of
   * fixtures refreshed, or null when it skipped (no key / no window).
   */
  async syncLiveIfActive(): Promise<number | null> {
    if (!this.apiKey && !this.rapidApiKey) return null;
    if (!(await this.hasActiveWindow())) return null;
    void this.syncPreMatchLineups();
    return this.syncLiveScores();
  }

  /**
   * Copy live fixture scores/status onto campaign posts when denormalized fields
   * lag behind the fixture collection (e.g. syncLiveScores missed a tick).
   * Pure DB work — runs every cron tick so existing mobile apps get IN_PLAY
   * matchScore via feed reads and POST_VOTE_UPDATED pushes.
   */
  async reconcileLivePosts(): Promise<number> {
    const liveFixtures = await this.fixtureModel
      .find({ status: { $in: ['IN_PLAY', 'PAUSED'] } })
      .exec();

    const seen = new Set(liveFixtures.map((f) => f._id.toHexString()));
    const livePostFixtureIds = await this.postModel
      .distinct('fixtureId', {
        matchType: true,
        fixtureId: { $exists: true, $ne: null },
        fixtureStatus: { $in: ['IN_PLAY', 'PAUSED'] },
      })
      .exec();
    const extraFixtureIds = livePostFixtureIds
      .filter(
        (id): id is string =>
          typeof id === 'string' && Types.ObjectId.isValid(id),
      )
      .map((id) => new Types.ObjectId(id));
    if (extraFixtureIds.length > 0) {
      const extras = await this.fixtureModel
        .find({
          _id: { $in: extraFixtureIds },
          status: { $in: ['IN_PLAY', 'PAUSED'] },
        })
        .exec();
      for (const f of extras) {
        if (!seen.has(f._id.toHexString())) liveFixtures.push(f);
      }
    }

    let updated = 0;
    for (const fixture of liveFixtures) {
      try {
        const synced = await this.syncCampaignPostFromFixture(fixture);
        if (!synced) continue;
        updated += 1;
        const minute =
          fixture.status === 'IN_PLAY' || fixture.status === 'PAUSED'
            ? (fixture.minute ?? null)
            : null;
        this.logger.log(
          `Reconciled live fixture → post: ${fixture.homeTeam.name} vs ${fixture.awayTeam.name} (${fixture.score?.home ?? 0}-${fixture.score?.away ?? 0}, ${fixture.status}${minute != null ? ` ${minute}'` : ''})`,
        );
      } catch (err) {
        this.logger.error(
          `reconcileLivePosts: failed for fixture ${fixture._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return updated;
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
        const post = await this.postModel
          .findById(fixture.campaignPostId)
          .exec();
        const leadMin = post?.endingSoonLeadMinutes ?? 5;
        // Schedule winner reveal immediately for already-past matches
        const winnerScheduledAt = new Date(
          Math.min(matchEndedAt.getTime() + leadMin * 60 * 1000, now.getTime()),
        );

        await this.fixtureModel.updateOne(
          { _id: fixture._id },
          { $set: { matchEndedAt, winnerScheduledAt } },
        );

        const parsedForReconcile = {
          rawStatus: fixture.rawStatus ?? 'FT',
          home: fixture.score?.home ?? null,
          away: fixture.score?.away ?? null,
          fullTime:
            fixture.scoreFullTimeHome != null &&
            fixture.scoreFullTimeAway != null
              ? {
                  home: fixture.scoreFullTimeHome,
                  away: fixture.scoreFullTimeAway,
                }
              : null,
          extraTime:
            fixture.scoreExtraTimeHome != null &&
            fixture.scoreExtraTimeAway != null
              ? {
                  home: fixture.scoreExtraTimeHome,
                  away: fixture.scoreExtraTimeAway,
                }
              : null,
          penalty:
            fixture.scorePenaltyHome != null && fixture.scorePenaltyAway != null
              ? {
                  home: fixture.scorePenaltyHome,
                  away: fixture.scorePenaltyAway,
                }
              : null,
          wentToExtraTime: fixture.wentToExtraTime ?? false,
          wentToPenalties: fixture.wentToPenalties ?? false,
          predictionScore:
            fixture.scoreExtraTimeHome != null &&
            fixture.scoreExtraTimeAway != null
              ? {
                  home: fixture.scoreExtraTimeHome,
                  away: fixture.scoreExtraTimeAway,
                }
              : fixture.scoreFullTimeHome != null &&
                  fixture.scoreFullTimeAway != null
                ? {
                    home: fixture.scoreFullTimeHome,
                    away: fixture.scoreFullTimeAway,
                  }
                : fixture.score?.home != null && fixture.score?.away != null
                  ? { home: fixture.score.home, away: fixture.score.away }
                  : null,
          winner: fixture.score?.winner ?? null,
        };

        await this.postModel.updateOne(
          { _id: fixture.campaignPostId },
          {
            $set: {
              ...this.buildPostScoreUpdate(
                parsedForReconcile,
                fixture,
                'FINISHED',
                null,
              ),
              fixtureWinnerAt: winnerScheduledAt,
            },
          },
        );

        await pubsub.publish(POST_UPDATED, {
          postUpdated: {
            postId: (fixture.campaignPostId as Types.ObjectId).toHexString(),
          },
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

  async syncAllFinishedFixtures(): Promise<{
    synced: number;
    skipped: number;
    errors: number;
  }> {
    const fixtures = await this.fixtureModel
      .find({ status: 'FINISHED' })
      .exec();

    // Stamp fixtureId + lineupAvailable on every finished fixture's campaign post (idempotent)
    for (const fixture of fixtures) {
      if (!fixture.campaignPostId) continue;
      const fixtureIdStr = (fixture._id as Types.ObjectId).toHexString();
      const hasLineups =
        Array.isArray(fixture.lineups) && fixture.lineups.length > 0;
      await this.postModel.updateOne(
        { _id: fixture.campaignPostId },
        { $set: { fixtureId: fixtureIdStr, lineupAvailable: hasLineups } },
      );
    }

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const fixture of fixtures) {
      // Skip only when all data sets exist AND event goals match final score
      if (
        this.hasCompleteFixtureData(fixture) &&
        !this.eventsMismatchScore(fixture)
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
        this.logger.error(
          `Failed to sync fixture ${fixture.externalId}: ${String(e)}`,
        );
        errors++;
      }
    }

    this.logger.log(
      `Bulk sync complete: ${synced} synced, ${skipped} skipped (already had data), ${errors} errors`,
    );
    return { synced, skipped, errors };
  }

  /**
   * Admin single-fixture detail resync. Skips the API calls entirely if the
   * fixture already has complete, score-matching data — pass force=true to
   * bypass this (e.g. suspected data corruption) and always refetch.
   */
  async syncFixtureDetailsIfNeeded(
    fixtureId: string,
    force = false,
  ): Promise<{
    events: number;
    stats: number;
    lineups: number;
    error?: string;
  }> {
    const doc = await this.findById(fixtureId);
    if (!doc) {
      return { events: 0, stats: 0, lineups: 0, error: 'Fixture not found' };
    }
    if (
      !force &&
      this.hasCompleteFixtureData(doc) &&
      !this.eventsMismatchScore(doc)
    ) {
      return {
        events: doc.events?.length ?? 0,
        stats: doc.stats?.length ?? 0,
        lineups: doc.lineups?.length ?? 0,
        error: 'Skipped — already complete (pass force: true to override)',
      };
    }
    return this.syncMatchDetails(doc, true);
  }

  /**
   * Force-send the lineup-available notification for a fixture regardless of
   * whether lineups "just arrived" this tick. Use from admin mutation when the
   * automatic notification was missed (e.g. cron window was too narrow).
   */
  async sendLineupNotification(
    fixtureId: string,
  ): Promise<{ sent: number; error?: string }> {
    const fixture = await this.findById(fixtureId);
    if (!fixture) return { sent: 0, error: 'Fixture not found' };

    const hasLineups =
      Array.isArray(fixture.lineups) && fixture.lineups.length > 0;
    if (!hasLineups) {
      // No lineups in DB yet — attempt a live sync first, then re-check
      await this.syncMatchDetails(fixture, true).catch(() => {});
      const refreshed = await this.findById(fixtureId);
      const stillNone =
        !Array.isArray(refreshed?.lineups) || !refreshed!.lineups.length;
      if (stillNone)
        return { sent: 0, error: 'Lineups not yet available from the API' };
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
      const existing = await this.postModel
        .findById(fixture.campaignPostId)
        .select('_id')
        .exec();
      if (existing) {
        throw new BadRequestException(
          'Campaign post already exists for this fixture',
        );
      }
      // campaignPostId pointed at a deleted post — clear and recreate.
      await this.fixtureModel.updateOne(
        { _id: fixture._id },
        { $unset: { campaignPostId: '' } },
      );
      fixture.campaignPostId = undefined;
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
    const goLiveAt = matchPostGoLiveAt(kickoff);
    const now = new Date();

    const isScheduled = goLiveAt > now;
    const scheduledAt = isScheduled ? goLiveAt : undefined;
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
      // Denormalise the fixture link up-front so prediction/match features work
      // before the first details sync (which previously was the only place this
      // got set).
      fixtureId: (fixture._id as Types.ObjectId).toHexString(),
      ...denormalizedPostFieldsFromFixture(fixture),
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

  /**
   * Matches played per player id — counts distinct finished fixtures where the
   * player has a real (non-zero) rating (API rates everyone who featured).
   */
  private appearancesByPlayer(
    fixtures: FixtureDocument[],
  ): Map<number, number> {
    const sets = new Map<number, Set<string>>();
    for (const f of fixtures) {
      const fid = f._id.toHexString();
      for (const r of f.playerRatings ?? []) {
        if (r.playerId == null) continue;
        if (!(parseFloat(r.rating ?? '0') > 0)) continue;
        if (!sets.has(r.playerId)) sets.set(r.playerId, new Set());
        sets.get(r.playerId)!.add(fid);
      }
    }
    const out = new Map<number, number>();
    for (const [pid, s] of sets) out.set(pid, s.size);
    return out;
  }

  /** A real goal for scorer/assist tallies — excludes own goals, disallowed
   * goals, missed penalties and shootout goals. */
  private isCountedGoal(detail?: string | null): boolean {
    const d = (detail || '').toLowerCase();
    return (
      !d.includes('own goal') &&
      !d.includes('disallow') &&
      !d.includes('missed') &&
      !d.includes('shootout')
    );
  }

  async getTopScorers(): Promise<TopScorerGql[]> {
    const fixtures = await this.fixtureModel.find({ status: 'FINISHED' });
    const apps = this.appearancesByPlayer(fixtures);
    const map = new Map<string, TopScorerGql>();
    for (const f of fixtures) {
      for (const ev of f.events ?? []) {
        if (
          ev.type !== 'Goal' ||
          !this.isCountedGoal(ev.detail) ||
          !ev.player?.name
        )
          continue;
        // Group by player id when available (name varies across matches, e.g.
        // "Erling Haaland" vs "E. Haaland", and home/away side flips) — only
        // fall back to name when there's no id.
        const key =
          ev.player.id != null
            ? `id:${ev.player.id}`
            : `nm:${ev.player.name.toLowerCase().trim()}`;
        if (!map.has(key)) {
          const teamDoc = ev.team === 'home' ? f.homeTeam : f.awayTeam;
          map.set(key, {
            playerId: ev.player.id ?? null,
            name: ev.player.name,
            team: teamDoc.name,
            teamCrest: teamDoc.crest ?? null,
            goals: 0,
            matchesPlayed:
              ev.player.id != null ? (apps.get(ev.player.id) ?? 0) : 0,
          });
        }
        map.get(key)!.goals++;
      }
    }
    return [...map.values()]
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
      .slice(0, 20);
  }

  async getTopAssistants(): Promise<TopAssistantGql[]> {
    const fixtures = await this.fixtureModel.find({ status: 'FINISHED' });
    const apps = this.appearancesByPlayer(fixtures);
    const map = new Map<string, TopAssistantGql>();
    for (const f of fixtures) {
      for (const ev of f.events ?? []) {
        if (
          ev.type !== 'Goal' ||
          !this.isCountedGoal(ev.detail) ||
          !ev.assist?.name
        )
          continue;
        // Group by player id when available (name/side vary across matches).
        const key =
          ev.assist.id != null
            ? `id:${ev.assist.id}`
            : `nm:${ev.assist.name.toLowerCase().trim()}`;
        if (!map.has(key)) {
          const teamDoc = ev.team === 'home' ? f.homeTeam : f.awayTeam;
          map.set(key, {
            playerId: ev.assist.id ?? null,
            name: ev.assist.name,
            team: teamDoc.name,
            teamCrest: teamDoc.crest ?? null,
            assists: 0,
            matchesPlayed:
              ev.assist.id != null ? (apps.get(ev.assist.id) ?? 0) : 0,
          });
        }
        map.get(key)!.assists++;
      }
    }
    return [...map.values()]
      .sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name))
      .slice(0, 20);
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
      rawStatus: fixture.rawStatus ?? null,
      minute: fixture.minute ?? null,
      stage: fixture.stage,
      group: fixture.group,
      matchday: fixture.matchday,
      score: {
        home: fixture.score?.home ?? null,
        away: fixture.score?.away ?? null,
        // Normalize to canonical uppercase — older fixtures were stored as
        // 'home'/'away'/'draw' while deriveWinner now returns
        // 'HOME_TEAM'/'AWAY_TEAM'/'DRAW'. Clients expect the latter.
        winner: normalizeWinner(fixture.score?.winner),
      },
      fullTime:
        fixture.scoreFullTimeHome != null && fixture.scoreFullTimeAway != null
          ? { home: fixture.scoreFullTimeHome, away: fixture.scoreFullTimeAway }
          : null,
      extraTime:
        fixture.scoreExtraTimeHome != null && fixture.scoreExtraTimeAway != null
          ? {
              home: fixture.scoreExtraTimeHome,
              away: fixture.scoreExtraTimeAway,
            }
          : null,
      penalty:
        fixture.scorePenaltyHome != null && fixture.scorePenaltyAway != null
          ? { home: fixture.scorePenaltyHome, away: fixture.scorePenaltyAway }
          : null,
      wentToExtraTime: fixture.wentToExtraTime ?? false,
      wentToPenalties: fixture.wentToPenalties ?? false,
      venue: fixture.venue
        ? { name: fixture.venue.name, city: fixture.venue.city }
        : undefined,
      campaignPostId: fixture.campaignPostId?.toHexString(),
      autoScheduled: fixture.autoScheduled ?? false,
      hasDrawOption: fixture.hasDrawOption ?? false,
      matchEndedAt: fixture.matchEndedAt ?? null,
      winnerScheduledAt: fixture.winnerScheduledAt ?? null,
      // Coalesce nullable event strings to "" so the field is never null and
      // clients can safely call string methods (.toLowerCase/.includes) on them.
      events: (fixture.events ?? []).map((e) => {
        const ev = e as unknown as {
          toObject?: () => unknown;
        };
        const plain = (
          typeof ev.toObject === 'function' ? ev.toObject() : e
        ) as Record<string, unknown>;
        return {
          ...plain,
          team: (plain.team as string | null) ?? '',
          type: (plain.type as string | null) ?? '',
          detail: (plain.detail as string | null) ?? '',
        };
      }) as FixtureGql['events'],
      // Apply coach overrides at read time too, so fixtures already stored with
      // a missing coach (API gave a null-name placeholder) still show the real
      // manager without waiting for a lineup re-fetch.
      lineups: (fixture.lineups ?? []).map((l) => {
        const maybeDoc = l as unknown as { toObject?: () => unknown };
        const plain = (
          typeof maybeDoc.toObject === 'function' ? maybeDoc.toObject() : l
        ) as Record<string, unknown>;
        return {
          ...plain,
          coach: resolveLineupCoach(
            l.team === 'home'
              ? fixture.homeTeamExternalId
              : fixture.awayTeamExternalId,
            l.coach,
          ),
        };
      }) as FixtureGql['lineups'],
      stats: fixture.stats ?? [],
      playerRatings: fixture.playerRatings ?? [],
      playerMatchStats: fixture.playerMatchStats ?? [],
      detailsSyncedAt: fixture.detailsSyncedAt ?? null,
    };
  }
}
