/**
 * Final fix: England vs Croatia winner
 * - Delete stale "No winner determined" CampaignWinner record
 * - Set score.winner = 'home' (England won 4-2)
 * - Reset winnerScheduledAt to now so cron re-fires
 *
 * Run: node scripts/fix-missed-matches.mjs
 */
import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = "mongodb+srv://root:xC7JyYpw6SLgisZl@auth-graph.sfxwo.mongodb.net/ctrend?retryWrites=true&w=majority";
const client = new MongoClient(MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('ctrend');
  const fixtures = db.collection('fixtures');
  const winners = db.collection('campaignwinners');

  // England vs Croatia
  const fixtureId = new ObjectId('6a2b1663aaf7173668408c91');
  const winnerId  = new ObjectId('6a33542c735856cfdd99b507');

  // 1. Delete the bad CampaignWinner record
  const del = await winners.deleteOne({ _id: winnerId });
  console.log(`Deleted bad CampaignWinner: ${del.deletedCount}`);

  // 2. Set score.winner = 'home' (England won 4-2) and reset winnerScheduledAt
  const now = new Date();
  await fixtures.updateOne({ _id: fixtureId }, {
    $set: {
      'score.winner': 'home',
      winnerScheduledAt: now,
    }
  });
  console.log(`fixture.score.winner = 'home', winnerScheduledAt = now`);

  // Verify
  const f = await fixtures.findOne({ _id: fixtureId });
  console.log(`Verify — score: ${JSON.stringify(f.score)}, winnerScheduledAt: ${f.winnerScheduledAt}`);

  console.log('\n✅ Done — winner cron will announce England as winner within 60s');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => client.close());
