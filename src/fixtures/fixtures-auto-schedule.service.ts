import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Fixture, FixtureDocument } from './fixture.schema';
import { FixturesService } from './fixtures.service';
import { UsersService } from '../users/users.service';

/** Schedules campaign posts for fixtures kicking off within the next 72 hours. */
@Injectable()
export class FixturesAutoScheduleService implements OnModuleInit {
  private readonly logger = new Logger(FixturesAutoScheduleService.name);
  private readonly adminEmail: string;

  constructor(
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    private fixturesService: FixturesService,
    private usersService: UsersService,
    private configService: ConfigService,
  ) {
    this.adminEmail =
      this.configService.get<string>('WC_AUTO_SCHEDULE_ADMIN_EMAIL') ??
      'badhonkhanbk007@gmail.com';
  }

  async onModuleInit(): Promise<void> {
    // Run once on startup so deploys immediately fill the 72-hour window
    // and reconcile any finished matches that were missed during downtime.
    await this.scheduleUpcoming();
    await this.fixturesService.reconcileFinishedPosts();
    await this.fixturesService.reconcileIncompleteMatchEvents();
  }

  @Cron(CronExpression.EVERY_4_HOURS)
  async scheduleUpcoming(): Promise<void> {
    const admin = await this.usersService.findByEmail(this.adminEmail);
    if (!admin) {
      this.logger.warn(
        `Auto-schedule skipped: admin ${this.adminEmail} not found`,
      );
      return;
    }
    const adminId = admin._id.toHexString();

    const now = new Date();
    const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000); // backfill up to 48 h ago
    const windowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    // Fixtures within [-48h, +72h] that don't yet have a campaign post
    const pending = await this.fixtureModel
      .find({
        kickoff: { $gte: windowStart, $lte: windowEnd },
        campaignPostId: { $exists: false },
      })
      .exec();

    if (pending.length === 0) return;

    this.logger.log(
      `Auto-scheduling ${pending.length} fixture(s) in the next 72 h`,
    );

    for (const fixture of pending) {
      try {
        await this.fixturesService.createCampaignPost(
          fixture._id.toHexString(),
          adminId,
          { autoScheduled: true },
        );
        this.logger.log(
          `Scheduled post for fixture ${fixture.homeTeam.name} vs ${fixture.awayTeam.name} (${fixture.kickoff.toISOString()})`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to schedule post for fixture ${fixture._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
