import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const PLATFORM_SETTINGS_KEY = 'global';

export type PlatformSettingsDocument = HydratedDocument<PlatformSettings>;

@Schema({ collection: 'platform_settings', timestamps: true })
export class PlatformSettings {
  @Prop({ required: true, unique: true, default: PLATFORM_SETTINGS_KEY })
  key: string;

  /** When true, normal users may publish a compare to the entire platform (not as the brand). */
  @Prop({ default: false })
  allowUserGlobalPosts: boolean;

  /** Minimum Android versionCode; users below this see a blocking update prompt. 0 = off. */
  @Prop({ default: 0 })
  minAndroidVersionCode: number;

  /** Title/body shown in the blocking update modal (admin publish). */
  @Prop({ default: '' })
  androidUpdateTitle: string;

  @Prop({ default: '' })
  androidUpdateBody: string;

  /** When true, referral invites, code redemption, and referral-point awards are active. */
  @Prop({ default: false })
  referralSystemEnabled: boolean;

  /**
   * UTC month key (`YYYY-MM`) for the active engagement-coin competition.
   * Advanced by the monthly reset job on the 1st of each month.
   */
  @Prop({ default: '' })
  currentCoinMonthKey: string;
}

export const PlatformSettingsSchema =
  SchemaFactory.createForClass(PlatformSettings);
