import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PlatformSettings,
  PlatformSettingsDocument,
  PLATFORM_SETTINGS_KEY,
} from './platform-settings.schema';
import { PlatformSettingsGql } from './graphql/platform-settings.types';

@Injectable()
export class PlatformSettingsService {
  constructor(
    @InjectModel(PlatformSettings.name)
    private readonly model: Model<PlatformSettingsDocument>,
  ) {}

  async getDocument(): Promise<PlatformSettingsDocument> {
    const existing = await this.model
      .findOne({ key: PLATFORM_SETTINGS_KEY })
      .exec();
    if (existing) return existing;
    return this.model.create({
      key: PLATFORM_SETTINGS_KEY,
      allowUserGlobalPosts: false,
    });
  }

  async toGql(): Promise<PlatformSettingsGql> {
    const doc = await this.getDocument();
    return { allowUserGlobalPosts: doc.allowUserGlobalPosts ?? false };
  }

  async isUserGlobalPostsAllowed(): Promise<boolean> {
    const doc = await this.getDocument();
    return Boolean(doc.allowUserGlobalPosts);
  }

  async setAllowUserGlobalPosts(enabled: boolean): Promise<PlatformSettingsGql> {
    const doc = await this.model
      .findOneAndUpdate(
        { key: PLATFORM_SETTINGS_KEY },
        { $set: { allowUserGlobalPosts: enabled } },
        { upsert: true, new: true },
      )
      .exec();
    return { allowUserGlobalPosts: doc?.allowUserGlobalPosts ?? false };
  }
}
