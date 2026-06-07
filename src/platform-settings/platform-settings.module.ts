import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from './platform-settings.schema';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsResolver } from './platform-settings.resolver';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    NotificationsModule,
  ],
  providers: [PlatformSettingsService, PlatformSettingsResolver],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
