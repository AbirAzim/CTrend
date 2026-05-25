import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PromotionTokenDocument = HydratedDocument<PromotionToken> & {
  createdAt: Date;
};

@Schema({ timestamps: true })
export class PromotionToken {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  promotedBy: Types.ObjectId;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ default: false })
  rejected: boolean;
}

export const PromotionTokenSchema =
  SchemaFactory.createForClass(PromotionToken);
PromotionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
