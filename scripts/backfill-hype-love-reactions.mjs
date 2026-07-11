/**
 * Backfill: every existing "hype" (postreactions, kind: 'hype') becomes a
 * ❤️ Love reaction in the new postemojireactions collection.
 *
 * Needed because the multi-emoji post reactions feature reads its
 * breakdown/viewerReaction from postemojireactions, but posts hyped before
 * that feature shipped only have a row in the older postreactions
 * collection. Without this backfill those posts show a hype count with no
 * emoji breakdown.
 *
 * Safe to re-run: uses $setOnInsert so it never overwrites a reaction a
 * user has since explicitly picked (e.g. switched to 😂 after this runs).
 *
 * Run: node scripts/backfill-hype-love-reactions.mjs
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

function loadMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const match = env.match(/^MONGODB_URI=(.+)$/m);
  if (!match) throw new Error('MONGODB_URI not found in .env');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

const client = new MongoClient(loadMongoUri());

async function main() {
  await client.connect();
  const db = client.db();
  const hypes = db.collection('postreactions');
  const reactions = db.collection('postemojireactions');

  const cursor = hypes.find({ kind: 'hype' }, { projection: { postId: 1, userId: 1 } });
  const ops = [];
  let scanned = 0;
  for await (const row of cursor) {
    scanned++;
    ops.push({
      updateOne: {
        filter: { postId: row.postId, userId: row.userId },
        update: { $setOnInsert: { postId: row.postId, userId: row.userId, emoji: '❤️' } },
        upsert: true,
      },
    });
  }
  console.log(`Scanned ${scanned} existing hype rows.`);

  if (ops.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const result = await reactions.bulkWrite(ops, { ordered: false });
  console.log(`Backfilled ${result.upsertedCount} new ❤️ reactions (${scanned - result.upsertedCount} already had a reaction, left untouched).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => client.close());
