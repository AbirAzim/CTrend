import { Field, InputType, Int } from '@nestjs/graphql';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PostOptionInput } from './create-post.input';

@InputType()
export class UpdatePostInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  caption?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  imageUrls?: string[];

  @Field(() => [PostOptionInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => PostOptionInput)
  options?: PostOptionInput[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Set to attach a campaign; send empty string to detach. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  endingSoonLeadMinutes?: number;

  /** New voting end date-time (ISO). Must be in the future. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  votingEndsAt?: string;

  /** Reschedule a SCHEDULED post to a new future time (ISO). */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  scheduledAt?: string;

  /** Toggle a normal-user post between platform-wide (global) and friends-only. */
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  broadcastGlobally?: boolean;
}
