import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import { User, UserDocument, PushToken } from './user.schema';
import { UserGql } from './graphql/user.types';
import { UserRole } from '../common/enums';
import { ListUsersQuery } from './dto/list-users.input';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  /** Resolve the canonical roles array, falling back to the legacy `role` field. */
  resolveRoles(doc: UserDocument): UserRole[] {
    if (doc.roles?.length) return doc.roles;
    return [doc.role ?? UserRole.USER];
  }

  toGql(doc: UserDocument, activeRole?: UserRole): UserGql {
    const roles = this.resolveRoles(doc);
    const primaryRole = roles.includes(UserRole.ADMIN)
      ? UserRole.ADMIN
      : UserRole.USER;
    return {
      id: doc._id.toHexString(),
      email: doc.email,
      displayName: doc.displayName ?? null,
      username: doc.username,
      interests: doc.interests ?? [],
      role: activeRole ?? primaryRole,
      roles,
      bio: doc.bio,
      profileImageUrl: doc.profileImageUrl,
      emailVerified: doc.emailVerified ?? false,
      createdAt:
        (doc as UserDocument & { createdAt?: Date }).createdAt ?? new Date(),
    };
  }

  async findByPasswordResetToken(
    tokenHash: string,
  ): Promise<UserDocument | null> {
    return this.userModel.findOne({ passwordResetToken: tokenHash }).exec();
  }

  async create(data: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
    googleSub?: string;
    profileImageUrl?: string;
    interests?: string[];
    roles?: UserRole[];
    /** @deprecated use roles */
    role?: UserRole;
    emailVerified?: boolean;
  }): Promise<UserDocument> {
    const roles = data.roles ?? (data.role ? [data.role] : [UserRole.USER]);
    const primaryRole = roles.includes(UserRole.ADMIN)
      ? UserRole.ADMIN
      : UserRole.USER;
    const user = new this.userModel({
      ...data,
      email: normalizeEmail(data.email),
      interests: data.interests ?? [],
      role: primaryRole,
      roles,
      emailVerified: data.emailVerified ?? false,
    });
    return user.save();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: normalizeEmail(email) }).exec();
  }

  async findByEmails(emails: string[]): Promise<UserDocument[]> {
    const normalized = emails.map(normalizeEmail);
    return this.userModel.find({ email: { $in: normalized } }).exec();
  }

  async findByGoogleSub(sub: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ googleSub: sub }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.userModel.findById(id).exec();
  }

  /** Batch load users for comment/feed hydration (single round-trip). */
  async findByIds(ids: string[]): Promise<UserDocument[]> {
    const objectIds = [
      ...new Set(
        ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => id),
      ),
    ].map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return [];
    return this.userModel.find({ _id: { $in: objectIds } }).exec();
  }

  async updateProfile(
    userId: string,
    patch: {
      bio?: string;
      profileImageUrl?: string;
      interests?: string[];
      displayName?: string;
    },
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { $set: patch }, { new: true })
      .exec();
  }

  /** Base: alphanumeric slug from email local part or display name. */
  async ensureUniqueUsername(base: string): Promise<string> {
    const slug = slugifyUsername(base).slice(0, 24) || 'user';
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? slug : `${slug}${randomInt(1000, 9999)}`;
      const exists = await this.userModel.exists({ username: candidate });
      if (!exists) return candidate;
    }
    return `${slug}${randomInt(100000, 999999)}`;
  }

  async setRole(userId: string, role: UserRole): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { role, roles: [role] } },
        { new: true },
      )
      .exec();
  }

  async promoteToAdmin(email: string): Promise<UserDocument | null> {
    const normalized = normalizeEmail(email);
    return this.userModel
      .findOneAndUpdate(
        { email: normalized },
        {
          // Dual-role: keep user capability + add admin (matches invite-admin flow)
          $addToSet: { roles: { $each: [UserRole.USER, UserRole.ADMIN] } },
          $set: { role: UserRole.ADMIN },
        },
        { new: true },
      )
      .exec();
  }

  /** Remove admin role from a user. Ensures USER role remains so account is still valid. */
  async demoteFromAdmin(email: string): Promise<UserDocument | null> {
    const normalized = normalizeEmail(email);
    return this.userModel
      .findOneAndUpdate(
        { email: normalized },
        { $pull: { roles: UserRole.ADMIN }, $set: { role: UserRole.USER } },
        { new: true },
      )
      .exec();
  }

  async removeByEmail(email: string): Promise<boolean> {
    const result = await this.userModel
      .deleteOne({ email: normalizeEmail(email) })
      .exec();
    return result.deletedCount > 0;
  }

  private buildListFilter(role?: UserRole | string): Record<string, unknown> {
    if (!role) return {};
    // role='member' — anyone with user role (pure users + admin+user dual-role).
    // Excludes pure-admin-only accounts (admin with no user role anywhere).
    if (String(role) === 'member') {
      return {
        $nor: [
          {
            $and: [
              { $or: [{ roles: UserRole.ADMIN }, { role: UserRole.ADMIN }] },
              { $nor: [{ roles: UserRole.USER }, { role: UserRole.USER }] },
            ],
          },
        ],
      };
    }
    // role='user' returns ONLY pure users (excludes anyone holding admin role)
    if (String(role) === 'user') {
      return {
        $and: [
          { $or: [{ roles: 'user' }, { role: 'user' }] },
          { $nor: [{ roles: 'admin' }, { role: 'admin' }] },
        ],
      };
    }
    // role='admin' (or others): match the role in either field
    return { $or: [{ roles: role }, { role }] };
  }

  private buildListQuery(options: ListUsersQuery = {}): {
    filter: Record<string, unknown>;
    sort: Record<string, 1 | -1>;
  } {
    const clauses: Record<string, unknown>[] = [];
    const roleFilter = this.buildListFilter(
      options.role as UserRole | undefined,
    );
    if (Object.keys(roleFilter).length > 0) clauses.push(roleFilter);

    if (options.status === 'verified') {
      clauses.push({ emailVerified: true });
    } else if (options.status === 'unverified') {
      clauses.push({ emailVerified: { $ne: true } });
    }

    const search = options.search?.trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      const by = options.searchBy ?? 'all';
      if (by === 'email') clauses.push({ email: regex });
      else if (by === 'username') clauses.push({ username: regex });
      else if (by === 'name') clauses.push({ displayName: regex });
      else {
        clauses.push({
          $or: [{ email: regex }, { displayName: regex }, { username: regex }],
        });
      }
    }

    let filter: Record<string, unknown> = {};
    if (clauses.length === 1) filter = clauses[0]!;
    else if (clauses.length > 1) filter = { $and: clauses };

    const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> =
      options.sortBy === 'name'
        ? { displayName: sortOrder, username: sortOrder, createdAt: -1 }
        : { createdAt: sortOrder };

    return { filter, sort };
  }

  /** Ensure promoted admins retain user role in `roles[]` (legacy data repair). */
  private async repairAdminMemberRoles(): Promise<void> {
    await this.userModel.updateMany(
      {
        $or: [{ roles: UserRole.ADMIN }, { role: UserRole.ADMIN }],
        $nor: [{ roles: UserRole.USER }],
        role: { $ne: UserRole.USER },
      },
      { $addToSet: { roles: UserRole.USER } },
    );
  }

  async listUsers(
    skip = 0,
    take = 50,
    query: ListUsersQuery = {},
  ): Promise<UserDocument[]> {
    if (String(query.role) === 'member') {
      await this.repairAdminMemberRoles();
    }
    const { filter, sort } = this.buildListQuery(query);
    return this.userModel.find(filter).skip(skip).limit(take).sort(sort).exec();
  }

  async listUsersCount(query: ListUsersQuery = {}): Promise<number> {
    const { filter } = this.buildListQuery(query);
    return this.userModel.countDocuments(filter).exec();
  }

  async countUsers(): Promise<number> {
    return this.userModel.countDocuments().exec();
  }

  async findIdsByRole(role: UserRole): Promise<Types.ObjectId[]> {
    const docs = await this.userModel
      .find({ $or: [{ role }, { roles: role }] }, { _id: 1 })
      .lean()
      .exec();
    return docs.map((d) => d._id as Types.ObjectId);
  }

  /**
   * Find user ids whose display name or username matches `term`
   * (case-insensitive substring). Used to filter voter lists server-side.
   */
  async findIdsByNameSearch(term: string): Promise<Types.ObjectId[]> {
    const trimmed = term.trim();
    if (!trimmed) return [];
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    const docs = await this.userModel
      .find({ $or: [{ displayName: regex }, { username: regex }] }, { _id: 1 })
      .lean()
      .exec();
    return docs.map((d) => d._id as Types.ObjectId);
  }

  async findAllIds(): Promise<string[]> {
    const docs = await this.userModel.find({}, { _id: 1 }).lean().exec();
    return docs.map((d) => (d._id as Types.ObjectId).toHexString());
  }

  // ── Push tokens ────────────────────────────────────────────────

  /**
   * Register (upsert) a device push token for a user. A given token can only
   * belong to one user, so it is first detached from any other account (handles
   * the case where a device is re-used by a different user after logout).
   */
  async registerPushToken(
    userId: string,
    token: string,
    platform?: string,
  ): Promise<boolean> {
    const trimmed = token?.trim();
    if (!trimmed || !Types.ObjectId.isValid(userId)) return false;
    const oid = new Types.ObjectId(userId);

    // Detach this token from every account (including this one) so we can re-add a fresh entry.
    await this.userModel
      .updateMany(
        { 'pushTokens.token': trimmed },
        { $pull: { pushTokens: { token: trimmed } } },
      )
      .exec();

    await this.userModel
      .updateOne(
        { _id: oid },
        {
          $push: {
            pushTokens: {
              token: trimmed,
              platform: platform?.trim() || undefined,
              updatedAt: new Date(),
            },
          },
        },
      )
      .exec();
    return true;
  }

  async removePushToken(userId: string, token: string): Promise<boolean> {
    const trimmed = token?.trim();
    if (!trimmed || !Types.ObjectId.isValid(userId)) return false;
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(userId) },
        { $pull: { pushTokens: { token: trimmed } } },
      )
      .exec();
    return true;
  }

  /** All registered device tokens for a user (used by the push sender). */
  async getPushTokens(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const doc = await this.userModel
      .findById(userId, { pushTokens: 1 })
      .lean<{ pushTokens?: PushToken[] }>()
      .exec();
    return (doc?.pushTokens ?? []).map((t) => t.token).filter(Boolean);
  }

  /** All FCM tokens across every user — used for platform-wide broadcast. */
  async getAllPushTokens(): Promise<string[]> {
    const docs = await this.userModel
      .find({ 'pushTokens.0': { $exists: true } }, { pushTokens: 1 })
      .lean<{ pushTokens?: PushToken[] }[]>()
      .exec();
    return docs.flatMap((d) => (d.pushTokens ?? []).map((t) => t.token)).filter(Boolean);
  }

  /** Purge tokens that FCM reported as invalid/unregistered, across all users. */
  async removePushTokensEverywhere(tokens: string[]): Promise<void> {
    if (!tokens.length) return;
    await this.userModel
      .updateMany(
        { 'pushTokens.token': { $in: tokens } },
        { $pull: { pushTokens: { token: { $in: tokens } } } },
      )
      .exec();
  }

  async updateLastAndroidVersionCode(
    userId: string,
    versionCode: number,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    const safe = Math.max(0, Math.floor(Number(versionCode) || 0));
    if (safe <= 0) return;
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(userId) },
        { $max: { lastAndroidVersionCode: safe } },
      )
      .exec();
  }

  /** User ids on Android with a version below min (or unknown) — for update broadcasts. */
  async findIdsNeedingAndroidUpdate(minVersion: number): Promise<string[]> {
    if (minVersion <= 0) return [];
    const docs = await this.userModel
      .find({
        pushTokens: {
          $elemMatch: {
            platform: { $in: ['android', 'Android', 'ANDROID'] },
          },
        },
        $or: [
          { lastAndroidVersionCode: { $lt: minVersion } },
          { lastAndroidVersionCode: { $exists: false } },
          { lastAndroidVersionCode: 0 },
          { lastAndroidVersionCode: null },
        ],
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return docs.map((d) => d._id.toHexString());
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugifyUsername(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
