import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invitation, InvitationSchema } from './invitation.schema';
import { InvitationsService } from './invitations.service';
import { InvitationsResolver } from './invitations.resolver';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { CoinsModule } from '../coins/coins.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    UsersModule,
    MailModule,
    CoinsModule,
    NotificationsModule,
    PlatformSettingsModule,
  ],
  providers: [InvitationsService, InvitationsResolver],
  exports: [InvitationsService],
})
export class InvitationsModule {}
