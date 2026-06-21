import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MatchPredictionDocument = HydratedDocument<MatchPrediction> & {
  createdAt: Date;
  updatedAt: Date;
};

/**
 * A user's exact-score prediction for a match-type post (e.g. Brazil 2 - 3
 * Argentina). One prediction per user per post; editable/deletable until
 * kickoff. Winners are predictions whose score equals the fixture's final
 * pre-penalty score.
 */
@Schema({ timestamps: true })
export class MatchPrediction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  /** Fixture this prediction belongs to (denormalised for winner resolution). */
  @Prop({ type: Types.ObjectId, ref: 'Fixture', required: true })
  fixtureId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0, max: 99 })
  homeScore: number;

  @Prop({ type: Number, required: true, min: 0, max: 99 })
  awayScore: number;
}

export const MatchPredictionSchema =
  SchemaFactory.createForClass(MatchPrediction);
// One prediction per user per post.
MatchPredictionSchema.index({ postId: 1, userId: 1 }, { unique: true });
// List + count predictions for a post.
MatchPredictionSchema.index({ postId: 1, createdAt: -1 });
