import { Field, InputType, Int } from '@nestjs/graphql';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  OrgPostReach,
  PostFormat,
  PostType,
  Visibility,
} from '../../common/enums';

@InputType()
export class PostOptionInput {
  @Field()
  @IsString()
  @MaxLength(500)
  label: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  imageFocalX?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  imageFocalY?: number;
}

@InputType()
export class CreatePostInput {
  @Field(() => PostType, { nullable: true })
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;

  /** Voting layout. Defaults to `compare` when omitted (back-compat). */
  @Field(() => PostFormat, { nullable: true })
  @IsOptional()
  @IsEnum(PostFormat)
  format?: PostFormat;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  contentText?: string;

  // Frontend-friendly alias of contentText
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  caption?: string;

  /**
   * Compare images (compare format) OR body/context images (poll format).
   * Optional here — the service enforces the per-format minimum (compare needs
   * at least 2; poll allows 0+).
   */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @Field(() => [PostOptionInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostOptionInput)
  options?: PostOptionInput[];

  @Field()
  @IsString()
  categoryId: string;

  @Field(() => Visibility, { nullable: true })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @Field(() => OrgPostReach, { nullable: true })
  @IsOptional()
  @IsEnum(OrgPostReach)
  orgReach?: OrgPostReach;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  votingEndsAt?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  campaignId?: string;

  /** When true (and platform setting allows), post is visible + notified platform-wide as the user. */
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  broadcastGlobally?: boolean;
}
