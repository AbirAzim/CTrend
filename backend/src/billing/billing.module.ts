import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SubscriptionRecord,
  SubscriptionRecordSchema,
} from './subscription-record.schema';
import { BillingService } from './billing.service';
import { BillingResolver } from './billing.resolver';
import { StripeWebhookController } from './stripe.webhook.controller';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SubscriptionRecord.name, schema: SubscriptionRecordSchema },
    ]),
    OrganizationsModule,
  ],
  controllers: [StripeWebhookController],
  providers: [BillingService, BillingResolver],
  exports: [BillingService],
})
export class BillingModule {}
