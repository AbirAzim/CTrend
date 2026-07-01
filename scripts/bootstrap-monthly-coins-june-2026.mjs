/**
 * One-time bootstrap: finalize June 2026 from ledger (UTC), award podium, start July.
 *
 *   MONGODB_URI="mongodb://…" node scripts/bootstrap-monthly-coins-june-2026.mjs
 *
 * Safe to re-run — skips if June snapshots already exist.
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Set MONGODB_URI');
  process.exit(1);
}

const JUNE_KEY = '2026-06';
const JULY_KEY = '2026-07';
const PLATFORM_KEY = 'global';

const NON_ADMIN = {
  $nor: [{ roles: 'admin' }, { role: 'admin' }],
};

function monthBoundsUtc(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, 0));
  return { start, end };
}

async function aggregateMonth(db, monthKey) {
  const { start, end } = monthBoundsUtc(monthKey);
  const grouped = await db
    .collection('coinledgers')
    .aggregate([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: '$userId', coins: { $sum: '$amount' } } },
      { $match: { coins: { $gt: 0 } } },
    ])
    .toArray();

  if (grouped.length === 0) return [];

  const userIds = grouped.map((g) => g._id);
  const users = await db
    .collection('users')
    .find({ _id: { $in: userIds }, ...NON_ADMIN })
    .project({ createdAt: 1 })
    .toArray();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const rows = [];
  for (const g of grouped) {
    const user = userMap.get(g._id.toString());
    if (!user) continue;
    rows.push({
      userId: g._id,
      coins: g.coins,
      createdAt: user.createdAt ?? new Date(0),
    });
  }

  rows.sort((a, b) => {
    if (b.coins !== a.coins) return b.coins - a.coins;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return rows;
}

async function finalizeMonth(db, monthKey) {
  const snapshots = db.collection('coinmonthlysnapshots');
  const existing = await snapshots.countDocuments({ monthKey });
  if (existing > 0) {
    console.log(`Month ${monthKey} already finalized (${existing} snapshots) — skipping podium`);
    return;
  }

  const ranked = await aggregateMonth(db, monthKey);
  const top3 = ranked.slice(0, 3);
  const now = new Date();

  for (let i = 0; i < top3.length; i++) {
    const row = top3[i];
    const rank = i + 1;
    const inc =
      rank === 1
        ? { podiumFirstCount: 1 }
        : rank === 2
          ? { podiumSecondCount: 1 }
          : { podiumThirdCount: 1 };

    await db.collection('users').updateOne({ _id: row.userId }, { $inc: inc });
    await snapshots.insertOne({
      monthKey,
      userId: row.userId,
      rank,
      coins: row.coins,
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  #${rank} user=${row.userId} coins=${row.coins}`);
  }

  if (top3.length === 0) console.log(`  (no earners in ${monthKey})`);
}

async function syncMonthCoins(db, monthKey) {
  const ranked = await aggregateMonth(db, monthKey);
  await db.collection('users').updateMany({}, { $set: { coins: 0 } });
  for (const row of ranked) {
    await db
      .collection('users')
      .updateOne({ _id: row.userId }, { $set: { coins: row.coins } });
  }
  console.log(`Synced ${ranked.length} user balances for ${monthKey}`);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  console.log(`Finalizing ${JUNE_KEY} from ledger (UTC)…`);
  await finalizeMonth(db, JUNE_KEY);

  await db.collection('platform_settings').updateOne(
    { key: PLATFORM_KEY },
    { $set: { currentCoinMonthKey: JULY_KEY } },
    { upsert: true },
  );
  console.log(`Set currentCoinMonthKey → ${JULY_KEY}`);

  console.log(`Syncing July balances from ledger…`);
  await syncMonthCoins(db, JULY_KEY);

  await client.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
