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

  private toGqlFromDoc(doc: PlatformSettingsDocument | null): PlatformSettingsGql {
    return {
      allowUserGlobalPosts: doc?.allowUserGlobalPosts ?? false,
      minAndroidVersionCode: doc?.minAndroidVersionCode ?? 0,
      androidUpdateTitle: doc?.androidUpdateTitle ?? '',
      androidUpdateBody: doc?.androidUpdateBody ?? '',
      referralSystemEnabled: doc?.referralSystemEnabled ?? false,
      currentCoinMonthKey: doc?.currentCoinMonthKey?.trim() || '',
    };
  }

  async getDocument(): Promise<PlatformSettingsDocument> {
    const existing = await this.model
      .findOne({ key: PLATFORM_SETTINGS_KEY })
      .exec();
    if (existing) return existing;
    return this.model.create({
      key: PLATFORM_SETTINGS_KEY,
      allowUserGlobalPosts: false,
      minAndroidVersionCode: 0,
      androidUpdateTitle: '',
      androidUpdateBody: '',
      referralSystemEnabled: false,
    });
  }

  async toGql(): Promise<PlatformSettingsGql> {
    const doc = await this.getDocument();
    return this.toGqlFromDoc(doc);
  }

  async isUserGlobalPostsAllowed(): Promise<boolean> {
    const doc = await this.getDocument();
    return Boolean(doc.allowUserGlobalPosts);
  }

  async isReferralSystemEnabled(): Promise<boolean> {
    const doc = await this.getDocument();
    return Boolean(doc.referralSystemEnabled);
  }

  async setAllowUserGlobalPosts(enabled: boolean): Promise<PlatformSettingsGql> {
    const doc = await this.model
      .findOneAndUpdate(
        { key: PLATFORM_SETTINGS_KEY },
        { $set: { allowUserGlobalPosts: enabled } },
        { upsert: true, new: true },
      )
      .exec();
    return this.toGqlFromDoc(doc);
  }

  async setReferralSystemEnabled(enabled: boolean): Promise<PlatformSettingsGql> {
    const doc = await this.model
      .findOneAndUpdate(
        { key: PLATFORM_SETTINGS_KEY },
        { $set: { referralSystemEnabled: enabled } },
        { upsert: true, new: true },
      )
      .exec();
    return this.toGqlFromDoc(doc);
  }

  async setMinAndroidVersionCode(versionCode: number): Promise<PlatformSettingsGql> {
    const safe = Math.max(0, Math.floor(Number(versionCode) || 0));
    const doc = await this.model
      .findOneAndUpdate(
        { key: PLATFORM_SETTINGS_KEY },
        { $set: { minAndroidVersionCode: safe } },
        { upsert: true, new: true },
      )
      .exec();
    return this.toGqlFromDoc(doc);
  }

  async publishAndroidUpdateNotice(
    title: string,
    body: string,
    minVersionCode: number,
  ): Promise<PlatformSettingsGql> {
    const safeMin = Math.max(0, Math.floor(Number(minVersionCode) || 0));
    const doc = await this.model
      .findOneAndUpdate(
        { key: PLATFORM_SETTINGS_KEY },
        {
          $set: {
            minAndroidVersionCode: safeMin,
            androidUpdateTitle: title.trim(),
            androidUpdateBody: body.trim(),
          },
        },
        { upsert: true, new: true },
      )
      .exec();
    return this.toGqlFromDoc(doc);
  }

  async getCurrentCoinMonthKey(): Promise<string> {
    const doc = await this.getDocument();
    return doc.currentCoinMonthKey?.trim() || '';
  }

  async setCurrentCoinMonthKey(monthKey: string): Promise<void> {
    await this.model
      .findOneAndUpdate(
        { key: PLATFORM_SETTINGS_KEY },
        { $set: { currentCoinMonthKey: monthKey.trim() } },
        { upsert: true },
      )
      .exec();
  }
}
