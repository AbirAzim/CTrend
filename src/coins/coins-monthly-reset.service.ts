import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CoinsService } from './coins.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { currentCompetingMonthKey, nextMonthKey } from './coin-monthly.utils';

@Injectable()
export class CoinsMonthlyResetService implements OnModuleInit {
  private readonly logger = new Logger(CoinsMonthlyResetService.name);

  constructor(
    private readonly coins: CoinsService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.catchUpMissedMonths();
    } catch (err) {
      this.logger.error(
        `Monthly coin catch-up failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 00:00 UTC on the 1st — finalize the month that just ended. */
  @Cron('0 0 1 * *')
  async onFirstOfMonth(): Promise<void> {
    try {
      const competing = currentCompetingMonthKey();
      const doc = await this.platformSettings.getDocument();
      const stored = doc.currentCoinMonthKey?.trim() || competing;
      if (stored >= competing) {
        this.logger.debug(`Coin month already at ${stored} — cron noop`);
        return;
      }
      await this.advanceToMonth(competing);
    } catch (err) {
      this.logger.error(
        `Monthly coin cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Finalize any months between stored key and the current competing month. */
  async catchUpMissedMonths(): Promise<void> {
    const competing = currentCompetingMonthKey();
    const doc = await this.platformSettings.getDocument();
    const stored = doc.currentCoinMonthKey?.trim();

    if (!stored) {
      await this.platformSettings.setCurrentCoinMonthKey(competing);
      await this.coins.syncMonthCoinsFromLedger(competing);
      this.logger.log(`Initialized coin month to ${competing}`);
      return;
    }

    if (stored >= competing) return;

    await this.advanceToMonth(competing);
  }

  /**
   * Finalize every month from `stored` up to (but not including) `targetMonth`,
   * then sync balances for `targetMonth`.
   */
  async advanceToMonth(targetMonth: string): Promise<void> {
    const doc = await this.platformSettings.getDocument();
    let cursor = doc.currentCoinMonthKey?.trim() || targetMonth;

    if (!cursor || cursor >= targetMonth) {
      await this.platformSettings.setCurrentCoinMonthKey(targetMonth);
      await this.coins.syncMonthCoinsFromLedger(targetMonth);
      return;
    }

    while (cursor < targetMonth) {
      await this.coins.finalizeMonth(cursor);
      cursor = nextMonthKey(cursor);
    }

    await this.platformSettings.setCurrentCoinMonthKey(targetMonth);
    await this.coins.syncMonthCoinsFromLedger(targetMonth);
    this.logger.log(`Advanced coin competition to ${targetMonth}`);
  }

  /** Manual bootstrap — finalize a specific month then jump to the next. */
  async bootstrapFinalizeMonth(
    monthKey: string,
    nextMonth: string,
  ): Promise<void> {
    await this.coins.finalizeMonth(monthKey);
    await this.platformSettings.setCurrentCoinMonthKey(nextMonth);
    await this.coins.syncMonthCoinsFromLedger(nextMonth);
    this.logger.log(
      `Bootstrapped: finalized ${monthKey}, now competing in ${nextMonth}`,
    );
  }
}
