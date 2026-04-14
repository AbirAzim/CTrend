import { Field, InputType, Int } from '@nestjs/graphql';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrgPostReach, PostType, Visibility } from '../../common/enums';

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
}

@InputType()
export class CreatePostInput {
  @Field(() => PostType, { nullable: true })
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;

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

  @Field(() => [String])
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  imageUrls: string[];

  @Field(() => [PostOptionInput])
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => PostOptionInput)
  options: PostOptionInput[];

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
}
