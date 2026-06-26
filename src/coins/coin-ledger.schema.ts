import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CoinLedgerDocument = HydratedDocument<CoinLedger> & {
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One row per coin-earning event. Doubles as the public coin history.
 * The unique (userId, type, refId) index makes awarding idempotent — a user
 * earns coins once per target (e.g. hyping the same post twice = one award).
 */
@Schema({ timestamps: true })
export class CoinLedger {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Event type — see CoinType. */
  @Prop({ required: true })
  type: string;

  /** Dedupe key (postId, fixtureId, "postId:actorId", date string, …). */
  @Prop({ required: true })
  refId: string;

  @Prop({ required: true })
  amount: number;

  /** For referral events — the other party (invitee on INVITE, inviter on REFERRAL_INVITEE). */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  relatedUserId?: Types.ObjectId;
}

export const CoinLedgerSchema = SchemaFactory.createForClass(CoinLedger);
CoinLedgerSchema.index({ userId: 1, type: 1, refId: 1 }, { unique: true });
CoinLedgerSchema.index({ userId: 1, createdAt: -1 }); // history feed
