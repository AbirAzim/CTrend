import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoinLedger, CoinLedgerDocument } from './coin-ledger.schema';
import { User, UserDocument } from '../users/user.schema';
import { CoinType, CoinTypeValue, COIN_AMOUNTS } from './coins.constants';
import { UserRole } from '../common/enums';
import { currentCompetingMonthKey, monthBoundsUtc } from './coin-monthly.utils';
import {
  CoinMonthlySnapshot,
  CoinMonthlySnapshotDocument,
} from './coin-monthly-snapshot.schema';

export type AwardResult = { awarded: number; balance: number };

export type MonthlyPodiumStats = {
  firstPlaceCount: number;
  secondPlaceCount: number;
  thirdPlaceCount: number;
};

export type MonthCoinRow = {
  userId: string;
  coins: number;
  createdAt: Date;
};

/** Users with admin in `roles[]` or legacy `role` are excluded from public leaderboards. */
const NON_ADMIN_LEADERBOARD_FILTER = {
  $nor: [{ roles: UserRole.ADMIN }, { role: UserRole.ADMIN }],
};

export function userHoldsAdminRole(
  user: Pick<User, 'role' | 'roles'>,
): boolean {
  return user.roles?.includes(UserRole.ADMIN) || user.role === UserRole.ADMIN;
}

@Injectable()
export class CoinsService {
  private readonly logger = new Logger(CoinsService.name);

  constructor(
    @InjectModel(CoinLedger.name)
    private readonly ledgerModel: Model<CoinLedgerDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(CoinMonthlySnapshot.name)
    private readonly snapshotModel: Model<CoinMonthlySnapshotDocument>,
  ) {}

  /**
   * Idempotently award coins for an event. Returns how many were *newly*
   * awarded (0 if the user already earned for this exact target) and the new
   * balance. Never throws — gamification must not break the host action.
   */
  async award(
    userId: string,
    type: CoinTypeValue,
    refId: string,
    amountOverride?: number,
    relatedUserId?: string,
  ): Promise<AwardResult> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) {
        return { awarded: 0, balance: 0 };
      }
      const amount = amountOverride ?? COIN_AMOUNTS[type] ?? 0;
      const uid = new Types.ObjectId(userId);
      if (amount <= 0)
        return { awarded: 0, balance: await this.getBalance(userId) };

      const res = await this.ledgerModel.updateOne(
        { userId: uid, type, refId },
        {
          $setOnInsert: {
            userId: uid,
            type,
            refId,
            amount,
            ...(relatedUserId && Types.ObjectId.isValid(relatedUserId)
              ? { relatedUserId: new Types.ObjectId(relatedUserId) }
              : {}),
          },
        },
        { upsert: true },
      );
      if (res.upsertedCount && res.upsertedCount > 0) {
        const updated = await this.userModel
          .findByIdAndUpdate(uid, { $inc: { coins: amount } }, { new: true })
          .exec();
        return { awarded: amount, balance: updated?.coins ?? amount };
      }
      return { awarded: 0, balance: await this.getBalance(userId) };
    } catch (err) {
      this.logger.warn(
        `award(${type}) failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { awarded: 0, balance: 0 };
    }
  }

  /**
   * Reverse a previously-awarded coin event (e.g. the user un-hyped a post).
   * Deletes the ledger entry and decrements the balance by the amount that was
   * originally awarded, clamped at zero. Idempotent — a no-op if no matching
   * entry exists. Never throws.
   */
  async revoke(
    userId: string,
    type: CoinTypeValue,
    refId: string,
  ): Promise<{ revoked: number; balance: number }> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) {
        return { revoked: 0, balance: 0 };
      }
      const uid = new Types.ObjectId(userId);
      const entry = await this.ledgerModel
        .findOneAndDelete({ userId: uid, type, refId })
        .exec();
      if (!entry) {
        return { revoked: 0, balance: await this.getBalance(userId) };
      }
      const amount = entry.amount ?? COIN_AMOUNTS[type] ?? 0;
      const updated = await this.userModel
        .findByIdAndUpdate(uid, { $inc: { coins: -amount } }, { new: true })
        .exec();
      let balance = updated?.coins ?? 0;
      if (balance < 0) {
        // Never let a balance go negative.
        await this.userModel.updateOne({ _id: uid }, { $set: { coins: 0 } });
        balance = 0;
      }
      return { revoked: amount, balance };
    } catch (err) {
      this.logger.warn(
        `revoke(${type}) failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { revoked: 0, balance: 0 };
    }
  }

  async getBalance(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    const u = await this.userModel.findById(userId, { coins: 1 }).exec();
    return u?.coins ?? 0;
  }

  /** Lifetime referral / invite points (INVITE + REFERRAL_INVITEE ledger entries). */
  async getReferralPoints(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    const rows = await this.ledgerModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          type: { $in: [CoinType.INVITE, CoinType.REFERRAL_INVITEE] },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return rows[0]?.total ?? 0;
  }

  /** Paginated referral-point ledger (INVITE + REFERRAL_INVITEE only). */
  async getReferralPointsHistory(
    userId: string,
    skip = 0,
    take = 30,
  ): Promise<CoinLedgerDocument[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    return this.ledgerModel
      .find({
        userId: new Types.ObjectId(userId),
        type: { $in: [CoinType.INVITE, CoinType.REFERRAL_INVITEE] },
      })
      .sort({ createdAt: -1 })
      .skip(Math.max(0, skip))
      .limit(Math.min(Math.max(1, take), 100))
      .exec();
  }

  async getHistory(
    userId: string,
    skip = 0,
    take = 30,
    monthKey = currentCompetingMonthKey(),
  ): Promise<CoinLedgerDocument[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const { start, end } = monthBoundsUtc(monthKey);
    return this.ledgerModel
      .find({
        userId: new Types.ObjectId(userId),
        createdAt: { $gte: start, $lt: end },
      })
      .sort({ createdAt: -1 })
      .skip(Math.max(0, skip))
      .limit(Math.min(Math.max(1, take), 100))
      .exec();
  }

  async getPodiumStats(userId: string): Promise<MonthlyPodiumStats> {
    if (!Types.ObjectId.isValid(userId)) {
      return { firstPlaceCount: 0, secondPlaceCount: 0, thirdPlaceCount: 0 };
    }
    const u = await this.userModel
      .findById(userId, {
        podiumFirstCount: 1,
        podiumSecondCount: 1,
        podiumThirdCount: 1,
      })
      .exec();
    return {
      firstPlaceCount: u?.podiumFirstCount ?? 0,
      secondPlaceCount: u?.podiumSecondCount ?? 0,
      thirdPlaceCount: u?.podiumThirdCount ?? 0,
    };
  }

  /**
   * Sum ledger amounts per user for a UTC calendar month (option B — ledger source of truth).
   */
  async aggregateMonthCoins(monthKey: string): Promise<MonthCoinRow[]> {
    const { start, end } = monthBoundsUtc(monthKey);
    const grouped = await this.ledgerModel.aggregate<{
      _id: Types.ObjectId;
      coins: number;
    }>([
      { $match: { createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: '$userId', coins: { $sum: '$amount' } } },
      { $match: { coins: { $gt: 0 } } },
    ]);

    if (grouped.length === 0) return [];

    const userIds = grouped.map((g) => g._id);
    const users = await this.userModel
      .find({ _id: { $in: userIds } }, { createdAt: 1, role: 1, roles: 1 })
      .exec();
    const userMap = new Map(users.map((u) => [u._id.toHexString(), u]));

    const rows: MonthCoinRow[] = [];
    for (const g of grouped) {
      const id = g._id.toHexString();
      const user = userMap.get(id);
      if (!user || userHoldsAdminRole(user)) continue;
      rows.push({
        userId: id,
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

  /** Set every user's cached balance from ledger totals for the given month. */
  async syncMonthCoinsFromLedger(monthKey: string): Promise<void> {
    const rows = await this.aggregateMonthCoins(monthKey);
    await this.userModel.updateMany({}, { $set: { coins: 0 } }).exec();
    for (const row of rows) {
      await this.userModel
        .updateOne(
          { _id: new Types.ObjectId(row.userId) },
          { $set: { coins: row.coins } },
        )
        .exec();
    }
  }

  /**
   * Finalize a month: snapshot top 3 from ledger, bump podium counters, save audit rows.
   * Does not reset balances — call syncMonthCoinsFromLedger for the new month after.
   */
  async finalizeMonth(monthKey: string): Promise<{ top3: MonthCoinRow[] }> {
    const existing = await this.snapshotModel
      .countDocuments({ monthKey })
      .exec();
    if (existing > 0) {
      this.logger.warn(
        `Month ${monthKey} already finalized (${existing} snapshots) — skipping`,
      );
      const top = await this.snapshotModel
        .find({ monthKey, rank: { $lte: 3 } })
        .sort({ rank: 1 })
        .exec();
      return {
        top3: top.map((s) => ({
          userId: s.userId.toHexString(),
          coins: s.coins,
          createdAt: s.finalizedAt,
        })),
      };
    }

    const ranked = await this.aggregateMonthCoins(monthKey);
    const top3 = ranked.slice(0, 3);
    const now = new Date();

    for (let i = 0; i < top3.length; i++) {
      const row = top3[i];
      const rank = i + 1;
      const uid = new Types.ObjectId(row.userId);
      const inc: Record<string, number> = {};
      if (rank === 1) inc.podiumFirstCount = 1;
      else if (rank === 2) inc.podiumSecondCount = 1;
      else if (rank === 3) inc.podiumThirdCount = 1;

      await this.userModel.updateOne({ _id: uid }, { $inc: inc }).exec();
      await this.snapshotModel.create({
        monthKey,
        userId: uid,
        rank,
        coins: row.coins,
        finalizedAt: now,
      });
    }

    this.logger.log(
      `Finalized coin month ${monthKey}: top3=${top3.map((r) => `${r.userId}:${r.coins}`).join(', ') || 'none'}`,
    );
    return { top3 };
  }

  /** Count non-admin users ranked above this user (same tie-break as getLeaderboard). */
  async getLeaderboardRank(userId: string): Promise<number | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const user = await this.userModel.findById(userId).exec();
    if (!user || (user.coins ?? 0) <= 0 || userHoldsAdminRole(user))
      return null;
    const coins = user.coins ?? 0;
    const createdAt = user.createdAt ?? new Date(0);
    const ahead = await this.userModel.countDocuments({
      ...NON_ADMIN_LEADERBOARD_FILTER,
      $or: [
        { coins: { $gt: coins } },
        { coins, createdAt: { $lt: createdAt } },
      ],
    });
    return ahead + 1;
  }

  /** Top coin earners for the current UTC month (admins excluded). */
  async getLeaderboard(take = 50): Promise<UserDocument[]> {
    return this.userModel
      .find({ coins: { $gt: 0 }, ...NON_ADMIN_LEADERBOARD_FILTER })
      .sort({ coins: -1, createdAt: 1 })
      .limit(Math.min(Math.max(1, take), 100))
      .exec();
  }

  /**
   * Claim the once-per-day streak bonus. Returns the award (0 if already
   * claimed today) plus the current streak length.
   */
  async claimDailyStreak(
    userId: string,
  ): Promise<AwardResult & { streakDays: number }> {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const result = await this.award(userId, CoinType.DAILY_STREAK, day);
    let streakDays = 0;
    try {
      const u = await this.userModel.findById(userId).exec();
      if (u) {
        if (result.awarded > 0) {
          const last = u.lastStreakAt ? new Date(u.lastStreakAt) : null;
          const yesterday = new Date(Date.now() - 86400000)
            .toISOString()
            .slice(0, 10);
          const lastDay = last ? last.toISOString().slice(0, 10) : null;
          streakDays = lastDay === yesterday ? (u.streakDays ?? 0) + 1 : 1;
          u.lastStreakAt = new Date();
          u.streakDays = streakDays;
          await u.save();
        } else {
          streakDays = u.streakDays ?? 0;
        }
      }
    } catch {
      /* streak metadata is best-effort */
    }
    return { ...result, streakDays };
  }
}
