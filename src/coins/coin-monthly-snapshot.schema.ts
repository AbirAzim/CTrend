import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CoinMonthlySnapshotDocument = HydratedDocument<CoinMonthlySnapshot> & {
  createdAt: Date;
  updatedAt: Date;
};

/** One row per user per finalized month (top earners stored; rank 1–3 get podium credit). */
@Schema({ timestamps: true })
export class CoinMonthlySnapshot {
  @Prop({ required: true })
  monthKey: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  rank: number;

  @Prop({ required: true })
  coins: number;

  @Prop({ type: Date, default: () => new Date() })
  finalizedAt: Date;
}

export const CoinMonthlySnapshotSchema =
  SchemaFactory.createForClass(CoinMonthlySnapshot);
CoinMonthlySnapshotSchema.index({ monthKey: 1, userId: 1 }, { unique: true });
CoinMonthlySnapshotSchema.index({ monthKey: 1, rank: 1 });
