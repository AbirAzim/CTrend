import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import { User, UserDocument } from './user.schema';
import { UserGql } from './graphql/user.types';
import { UserRole } from '../common/enums';
import {
  DEFAULT_MESSAGE_SOUND_ID,
  DEFAULT_NOTIFICATION_SOUND_ID,
  DEFAULT_VOTE_SOUND_ID,
  isMessageSoundId,
  isNotificationSoundId,
  isVoteSoundId,
} from './sound-preferences.constants';
import {
  ListUsersQuery,
  normalizeListUsersQuery,
} from './dto/list-users.input';

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
      voteSoundId: isVoteSoundId(doc.voteSoundId ?? '')
        ? doc.voteSoundId
        : DEFAULT_VOTE_SOUND_ID,
      notificationSoundId: isNotificationSoundId(doc.notificationSoundId ?? '')
        ? doc.notificationSoundId
        : DEFAULT_NOTIFICATION_SOUND_ID,
      messageSoundId: isMessageSoundId(doc.messageSoundId ?? '')
        ? doc.messageSoundId
        : DEFAULT_MESSAGE_SOUND_ID,
      emailVerified: doc.emailVerified ?? false,
      createdAt: (doc as UserDocument & { createdAt?: Date }).createdAt ?? new Date(),
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

  async updateProfile(
    userId: string,
    patch: {
      bio?: string;
      profileImageUrl?: string;
      interests?: string[];
      displayName?: string;
      voteSoundId?: string;
      notificationSoundId?: string;
      messageSoundId?: string;
    },
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { $set: patch }, { returnDocument: 'after' })
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
        { returnDocument: 'after' },
      )
      .exec();
  }

  async promoteToAdmin(email: string): Promise<UserDocument | null> {
    const normalized = normalizeEmail(email);
    return this.userModel
      .findOneAndUpdate(
        { email: normalized },
        {
          $addToSet: { roles: UserRole.ADMIN },
          $set: { role: UserRole.ADMIN },
        },
        { returnDocument: 'after' },
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
        { returnDocument: 'after' },
      )
      .exec();
  }

  async removeByEmail(email: string): Promise<boolean> {
    const result = await this.userModel
      .deleteOne({ email: normalizeEmail(email) })
      .exec();
    return result.deletedCount > 0;
  }

  private buildListFilter(role?: UserRole): Record<string, unknown> {
    if (!role) return {};
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
    const roleFilter = this.buildListFilter(options.role as UserRole | undefined);
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

  async listUsers(
    skip = 0,
    take = 50,
    query: ListUsersQuery = {},
  ): Promise<UserDocument[]> {
    const { filter, sort } = this.buildListQuery(query);
    return this.userModel
      .find(filter)
      .skip(skip)
      .limit(take)
      .sort(sort)
      .exec();
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

  async findAllIds(): Promise<string[]> {
    const docs = await this.userModel.find({}, { _id: 1 }).lean().exec();
    return docs.map((d) => (d._id as Types.ObjectId).toHexString());
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
