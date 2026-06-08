import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  // Admin-assignable accent color (hex, e.g. "#6366f1"). Optional — when unset
  // the frontend derives a deterministic per-category color.
  @Prop({ trim: true })
  color?: string;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
