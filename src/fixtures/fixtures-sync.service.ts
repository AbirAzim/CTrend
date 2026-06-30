import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { FixturesService } from './fixtures.service';

/**
 * Auto-refreshes World Cup fixture scores once a minute, but only while a match
 * is live or imminent (FixturesService.syncLiveIfActive gates the external call)
 * so the football-data.org free quota isn't burned when nothing is on.
 *
 * Disable with DISABLE_FIXTURES_SYNC=true.
 */
@Injectable()
export class FixturesSyncService {
  private readonly logger = new Logger(FixturesSyncService.name);
  private readonly disabled: boolean;
  private running = false;

  constructor(
    private readonly fixturesService: FixturesService,
    private readonly config: ConfigService,
  ) {
    this.disabled = this.config.get<string>('DISABLE_FIXTURES_SYNC') === 'true';
    if (this.disabled) {
      this.logger.warn('Fixtures auto-sync disabled (DISABLE_FIXTURES_SYNC=true)');
    }
  }

  @Cron('*/30 * * * * *')
  async syncLiveScores() {
    if (this.disabled || this.running) return;
    this.running = true;
    try {
      const count = await this.fixturesService.syncLiveIfActive();
      if (count !== null) {
        this.logger.log(`Live fixture sync ran — ${count} fixtures refreshed`);
      }
      // Always reconcile live + finished posts — catches denormalization drift
      // without extra API calls (existing mobile apps rely on post.matchScore).
      const liveReconciled = await this.fixturesService.reconcileLivePosts();
      if (liveReconciled > 0) {
        this.logger.log(`Live post reconcile — ${liveReconciled} post(s) refreshed`);
      }
      await this.fixturesService.reconcileFinishedPosts();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Live fixture sync skipped: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
