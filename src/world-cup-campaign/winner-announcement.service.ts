import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Fixture, FixtureDocument } from '../fixtures/fixture.schema';
import { CampaignWinner, CampaignWinnerDocument } from './campaign-winner.schema';
import { WorldCupCampaignService } from './world-cup-campaign.service';
import { POST_UPDATED, pubsub } from '../pubsub';

/**
 * Every minute: find fixtures whose winnerScheduledAt has passed and for which
 * no CampaignWinner has been recorded yet, then process the match result and
 * push a POST_UPDATED subscription so clients reveal the winner card.
 */
@Injectable()
export class WinnerAnnouncementService {
  private readonly logger = new Logger(WinnerAnnouncementService.name);

  constructor(
    @InjectModel(Fixture.name) private fixtureModel: Model<FixtureDocument>,
    @InjectModel(CampaignWinner.name)
    private campaignWinnerModel: Model<CampaignWinnerDocument>,
    private worldCupCampaignService: WorldCupCampaignService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async announceWinners(): Promise<void> {
    const now = new Date();

    // Find fixtures ready for winner announcement
    const ready = await this.fixtureModel
      .find({
        winnerScheduledAt: { $lte: now },
        matchEndedAt: { $ne: null },
        campaignPostId: { $exists: true, $ne: null },
      })
      .exec();

    if (!ready.length) return;

    // Filter out fixtures that already have a resolved winner record
    const fixtureIds = ready.map((f) => f._id);
    const existingRecords = await this.campaignWinnerModel
      .find({ fixtureId: { $in: fixtureIds } })
      .select('fixtureId userId note')
      .lean()
      .exec();

    const resolvedSet = new Set(
      existingRecords
        .filter(
          (r) =>
            r.userId != null || Boolean(r.note?.trim()),
        )
        .map((r) => r.fixtureId.toString()),
    );
    const pending = ready.filter((f) => !resolvedSet.has(f._id.toString()));

    for (const fixture of pending) {
      try {
        const winner = await this.worldCupCampaignService.processMatchResult(
          fixture._id.toHexString(),
        );
        this.logger.log(
          `Winner announced for ${fixture.homeTeam.name} vs ${fixture.awayTeam.name}: ${winner.user?.username ?? 'no winner'}`,
        );
        // Push real-time update so post cards transition to "winner revealed" state
        await pubsub.publish(POST_UPDATED, {
          postUpdated: { postId: fixture.campaignPostId!.toHexString() },
        });
      } catch (err) {
        this.logger.error(
          `Failed to process winner for fixture ${fixture._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
