import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  PaymentProvider,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../common/enums';

export type SubscriptionRecordDocument = HydratedDocument<SubscriptionRecord>;

@Schema({ timestamps: true })
export class SubscriptionRecord {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  organizationId?: Types.ObjectId;

  @Prop({ type: String, enum: PaymentProvider, required: true })
  provider: PaymentProvider;

  @Prop({ type: String, enum: SubscriptionPlan, required: true })
  plan: SubscriptionPlan;

  @Prop({ type: String, enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  @Prop()
  startDate?: Date;

  @Prop()
  endDate?: Date;

  @Prop({ default: 0 })
  postLimit: number;

  @Prop({ default: 0 })
  postsUsed: number;

  @Prop()
  stripeCustomerId?: string;

  @Prop()
  stripeSubscriptionId?: string;
}

export const SubscriptionRecordSchema =
  SchemaFactory.createForClass(SubscriptionRecord);
