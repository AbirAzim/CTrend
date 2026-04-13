import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole } from '../common/enums';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  /** Shown to clients as displayName (signup / Google). */
  @Prop({ trim: true })
  displayName?: string;

  @Prop({ sparse: true, unique: true })
  googleSub?: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: [String], default: [] })
  interests: string[];

  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ trim: true })
  bio?: string;

  @Prop()
  profileImageUrl?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
