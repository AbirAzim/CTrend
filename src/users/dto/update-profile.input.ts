import { Field, InputType } from '@nestjs/graphql';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  MESSAGE_SOUND_IDS,
  NOTIFICATION_SOUND_IDS,
  VOTE_SOUND_IDS,
} from '../sound-preferences.constants';

@InputType()
export class UpdateProfileInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  profileImageUrl?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsIn([...VOTE_SOUND_IDS])
  voteSoundId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsIn([...NOTIFICATION_SOUND_IDS])
  notificationSoundId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsIn([...MESSAGE_SOUND_IDS])
  messageSoundId?: string;
}
