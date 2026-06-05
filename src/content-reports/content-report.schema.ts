import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ContentReportReasonId,
  ContentReportTargetType,
} from '../common/enums';

export type ContentReportDocument = HydratedDocument<ContentReport> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class ContentReport {
  @Prop({ type: String, enum: ContentReportTargetType, required: true })
  targetType: ContentReportTargetType;

  @Prop({ type: Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ type: String, enum: ContentReportReasonId, required: true })
  reasonId: ContentReportReasonId;

  @Prop({ trim: true, maxlength: 1000 })
  details?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  reporterId: Types.ObjectId;

  @Prop({ trim: true, maxlength: 500 })
  contextUrl?: string;
}

export const ContentReportSchema = SchemaFactory.createForClass(ContentReport);
ContentReportSchema.index(
  { targetType: 1, targetId: 1, reporterId: 1 },
  { unique: true },
);
ContentReportSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
