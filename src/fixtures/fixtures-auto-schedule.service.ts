import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Fixture, FixtureDocument } from './fixture.schema';
import { FixturesService } from './fixtures.service';
import { UsersService } from '../users/users.service';

/** How far back we still create posts for fixtures that were missed (e.g. deploy downtime). */
const SCHEDULE_BACKFILL_MS = 48 * 60 * 60 * 1000;

/**
 * Keeps the World Cup fixture list in sync with API-Football and auto-creates
 * scheduled campaign posts (24 h before kickoff) for every match that appears
 * in the API without a post yet.
 *
 * Disable with DISABLE_WC_FIXTURE_AUTO_IMPORT=true.
 */
@Injectable()
export class FixturesAutoScheduleService implements OnModuleInit {
  private readonly logger = new Logger(FixturesAutoScheduleService.name);
  private readonly adminEmail: string;
  private readonly disabled: boolean;
  private running = false;

  constructor(
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    private fixturesService: FixturesService,
    private usersService: UsersService,
    private configService: ConfigService,
  ) {
    this.adminEmail =
      this.configService.get<string>('WC_AUTO_SCHEDULE_ADMIN_EMAIL') ??
      'badhonkhanbk007@gmail.com';
    this.disabled =
      this.configService.get<string>('DISABLE_WC_FIXTURE_AUTO_IMPORT') ===
      'true';
    if (this.disabled) {
      this.logger.warn(
        'WC fixture import + auto-schedule disabled (DISABLE_WC_FIXTURE_AUTO_IMPORT=true)',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.disabled) return;
    // Run once on startup so deploys immediately import new rounds and schedule posts.
    await this.syncAndSchedule();
    await this.fixturesService.reconcileFinishedPosts();
    await this.fixturesService.reconcileIncompleteMatchEvents();
  }

  // Fixture list + standings barely change mid-tournament (only on
  // postponements/knockout pairing announcements) — twice a day is plenty,
  // and the on-boot sync above already covers freshness right after a deploy.
  @Cron(CronExpression.EVERY_12_HOURS)
  async syncAndScheduleCron(): Promise<void> {
    if (this.disabled) return;
    await this.syncAndSchedule();
    await this.fixturesService.reconcileIncompleteMatchEvents();
  }

  /** Pull all fixtures from API-Football, then schedule posts for any without one. */
  async syncAndSchedule(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const synced = await this.fixturesService.syncFixtures();
      if (synced > 0) {
        this.logger.log(
          `Imported/updated ${synced} fixture(s) from API-Football`,
        );
      }
      const realigned =
        await this.fixturesService.reconcileScheduledMatchPostDates();
      if (realigned > 0) {
        this.logger.log(
          `Realigned publish time for ${realigned} scheduled match post(s) (kickoff − 24 h)`,
        );
      }
      await this.schedulePendingPosts();
    } catch (err) {
      this.logger.error(
        `WC sync + auto-schedule failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Create campaign posts for every non-finished fixture that lacks one.
   * No upper kickoff window — quarter-finals etc. are scheduled as soon as the API lists them.
   */
  async schedulePendingPosts(): Promise<void> {
    const admin = await this.usersService.findByEmail(this.adminEmail);
    if (!admin) {
      this.logger.warn(
        `Auto-schedule skipped: admin ${this.adminEmail} not found`,
      );
      return;
    }
    const adminId = admin._id.toHexString();

    const now = new Date();
    const windowStart = new Date(now.getTime() - SCHEDULE_BACKFILL_MS);

    const pending = await this.fixtureModel
      .find({
        campaignPostId: { $exists: false },
        kickoff: { $gte: windowStart },
        status: { $nin: ['FINISHED', 'CANCELLED', 'ABANDONED', 'AWARDED'] },
      })
      .sort({ kickoff: 1 })
      .exec();

    if (pending.length === 0) return;

    this.logger.log(
      `Auto-scheduling ${pending.length} fixture(s) without campaign posts`,
    );

    for (const fixture of pending) {
      try {
        await this.fixturesService.createCampaignPost(
          fixture._id.toHexString(),
          adminId,
          { autoScheduled: true },
        );
        this.logger.log(
          `Scheduled post for ${fixture.homeTeam.name} vs ${fixture.awayTeam.name} (${fixture.stage}, ${fixture.kickoff.toISOString()})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to schedule post for fixture ${fixture._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** @deprecated Use syncAndSchedule — kept for scripts that only schedule. */
  async scheduleUpcoming(): Promise<void> {
    await this.schedulePendingPosts();
  }
}
