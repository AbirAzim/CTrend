/**
 * Manual one-shot: import fixtures from API-Football + schedule campaign posts.
 * Production does this automatically every 4 h via FixturesAutoScheduleService.
 *
 * Run from repo root:
 *   npx ts-node -r tsconfig-paths/register scripts/sync-and-schedule-r16.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { FixturesAutoScheduleService } from '../src/fixtures/fixtures-auto-schedule.service';
import { Fixture, FixtureDocument } from '../src/fixtures/fixture.schema';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const autoSchedule = app.get(FixturesAutoScheduleService);
    const fixtureModel = app.get<Model<FixtureDocument>>(
      getModelToken(Fixture.name),
    );

    await autoSchedule.syncAndSchedule();

    const total = await fixtureModel.countDocuments({});
    const withPosts = await fixtureModel.countDocuments({
      campaignPostId: { $exists: true },
    });
    const pending = await fixtureModel.countDocuments({
      campaignPostId: { $exists: false },
      status: { $nin: ['FINISHED', 'CANCELLED', 'ABANDONED', 'AWARDED'] },
    });
    console.log(
      `\n✅ Done — ${withPosts}/${total} fixtures have campaign posts (${pending} still pending)`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
