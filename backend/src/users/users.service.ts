import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './user.schema';
import { UserGql } from './graphql/user.types';
import { UserRole } from '../common/enums';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  toGql(doc: UserDocument): UserGql {
    return {
      id: doc._id.toHexString(),
      username: doc.username,
      email: doc.email,
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
    interests?: string[];
    role?: UserRole;
  }): Promise<UserDocument> {
    const user = new this.userModel({
      ...data,
      interests: data.interests ?? [],
      role: data.role ?? UserRole.USER,
    });
    return user.save();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.userModel.findById(id).exec();
  }

  async updateProfile(
    userId: string,
    patch: { bio?: string; profileImageUrl?: string; interests?: string[] },
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { $set: patch }, { new: true })
      .exec();
  }
}
