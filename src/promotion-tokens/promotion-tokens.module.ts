import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import {
  PromotionToken,
  PromotionTokenSchema,
} from './promotion-token.schema';
import { PromotionTokensService } from './promotion-tokens.service';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { Invitation, InvitationSchema } from '../invitations/invitation.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: PromotionToken.name, schema: PromotionTokenSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    forwardRef(() => UsersModule),
    MailModule,
  ],
  providers: [PromotionTokensService],
  exports: [PromotionTokensService],
})
export class PromotionTokensModule {}
