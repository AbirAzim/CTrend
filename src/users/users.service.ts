import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import { User, UserDocument } from './user.schema';
import { UserGql } from './graphql/user.types';
import { UserRole } from '../common/enums';

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
          $addToSet: { roles: UserRole.ADMIN },
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

  async listUsers(
    skip = 0,
    take = 50,
    role?: UserRole,
  ): Promise<UserDocument[]> {
    const filter = role ? { roles: role } : {};
    return this.userModel
      .find(filter)
      .skip(skip)
      .limit(take)
      .sort({ createdAt: -1 })
      .exec();
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
