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
}

export const PlatformSettingsSchema =
  SchemaFactory.createForClass(PlatformSettings);
