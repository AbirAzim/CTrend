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

  toGql(doc: UserDocument): UserGql {
    return {
      id: doc._id.toHexString(),
      email: doc.email,
      displayName: doc.displayName ?? null,
      username: doc.username,
      interests: doc.interests ?? [],
      role: doc.role,
      bio: doc.bio,
      profileImageUrl: doc.profileImageUrl,
    };
  }

  async create(data: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
    googleSub?: string;
    profileImageUrl?: string;
    interests?: string[];
    role?: UserRole;
  }): Promise<UserDocument> {
    const user = new this.userModel({
      ...data,
      email: normalizeEmail(data.email),
      interests: data.interests ?? [],
      role: data.role ?? UserRole.USER,
    });
    return user.save();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: normalizeEmail(email) }).exec();
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
