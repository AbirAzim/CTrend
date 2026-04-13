import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SubscriptionPlan } from '../common/enums';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ timestamps: true })
export class Organization {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerUserId: Types.ObjectId;

  @Prop({ type: String, enum: SubscriptionPlan, default: SubscriptionPlan.FREE })
  subscriptionPlan: SubscriptionPlan;

  @Prop({ default: 0 })
  postLimit: number;

  @Prop({ default: 0 })
  postsUsed: number;

  /** Premium: global posts used in current billing month */
  @Prop({ default: 0 })
  globalPostsThisMonth: number;

  @Prop()
  globalPostsMonthKey?: string;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
