/**
 * Backfill denormalized fixtureScore / fixtureStatus on campaign match posts
 * that were created without them (matchScore was null in GraphQL).
 *
 * Also syncs from the fixtures collection so live scores flow to mobile
 * without an app update.
 *
 * Run: node scripts/fix-live-match-posts.mjs
 * Optional: node scripts/fix-live-match-posts.mjs 6a40063a8d82425dfa7d54af
 */
import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI =
  process.env.MONGODB_URI ??
  'mongodb+srv://root:xC7JyYpw6SLgisZl@auth-graph.sfxwo.mongodb.net/ctrend?retryWrites=true&w=majority';

const IVORY_NORWAY_POST_ID = '6a40063a8d82425dfa7d54af';
const IVORY_NORWAY_FIXTURE_ID = '6a3f36647fb109c83c305a8f';

function fieldsFromFixture(fixture) {
  const isLive = fixture.status === 'IN_PLAY' || fixture.status === 'PAUSED';
  return {
    fixtureStatus: fixture.status,
    fixtureMinute: isLive ? (fixture.minute ?? null) : null,
    fixtureStage: fixture.stage,
    hasDrawOption: fixture.hasDrawOption ?? fixture.stage === 'GROUP_STAGE',
    fixtureId: fixture._id.toHexString(),
    fixtureScore: {
      home: fixture.score?.home ?? null,
      away: fixture.score?.away ?? null,
      phase: fixture.rawStatus ?? null,
      fullTimeHome: fixture.scoreFullTimeHome ?? null,
      fullTimeAway: fixture.scoreFullTimeAway ?? null,
      extraTimeHome: fixture.scoreExtraTimeHome ?? null,
      extraTimeAway: fixture.scoreExtraTimeAway ?? null,
      penaltyHome: fixture.scorePenaltyHome ?? null,
      penaltyAway: fixture.scorePenaltyAway ?? null,
      wentToExtraTime: fixture.wentToExtraTime ?? false,
      wentToPenalties: fixture.wentToPenalties ?? false,
    },
  };
}

async function main() {
  const onlyPostId = process.argv[2] ?? null;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db('ctrend');
    const posts = db.collection('posts');
    const fixtures = db.collection('fixtures');

    const query = onlyPostId
      ? { _id: new ObjectId(onlyPostId) }
      : { matchType: true };

    const matchPosts = await posts.find(query).toArray();
    let updated = 0;

    for (const post of matchPosts) {
      let fixture = null;
      if (post.fixtureId && ObjectId.isValid(post.fixtureId)) {
        fixture = await fixtures.findOne({ _id: new ObjectId(post.fixtureId) });
      }
      if (!fixture) {
        fixture = await fixtures.findOne({ campaignPostId: post._id });
      }
      if (!fixture) {
        console.warn(`Skip post ${post._id} — no linked fixture`);
        continue;
      }

      const needsScore =
        !post.fixtureScore ||
        post.fixtureStatus == null ||
        (fixture.status === 'IN_PLAY' &&
          (post.fixtureStatus !== 'IN_PLAY' ||
            post.fixtureScore?.home !== fixture.score?.home ||
            post.fixtureScore?.away !== fixture.score?.away));

      if (!needsScore && post.fixtureScore) {
        continue;
      }

      const $set = fieldsFromFixture(fixture);
      await posts.updateOne({ _id: post._id }, { $set });
      updated += 1;
      const label = `${fixture.homeTeam?.name} vs ${fixture.awayTeam?.name}`;
      console.log(
        `✓ post ${post._id} ← fixture ${fixture._id} (${label}) status=${$set.fixtureStatus} score=${$set.fixtureScore.home ?? '?'}-${$set.fixtureScore.away ?? '?'}`,
      );
    }

    const ivoryPost = await posts.findOne({ _id: new ObjectId(IVORY_NORWAY_POST_ID) });
    const ivoryFixture = await fixtures.findOne({ _id: new ObjectId(IVORY_NORWAY_FIXTURE_ID) });
    console.log('\n--- Ivory Coast vs Norway ---');
    console.log('fixture:', ivoryFixture?.status, ivoryFixture?.score, 'kickoff:', ivoryFixture?.kickoff);
    console.log(
      'post:',
      ivoryPost?.fixtureStatus,
      ivoryPost?.fixtureScore,
      'votingEndsAt:',
      ivoryPost?.votingEndsAt,
    );
    console.log(`\n✅ Done — ${updated} post(s) backfilled`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
