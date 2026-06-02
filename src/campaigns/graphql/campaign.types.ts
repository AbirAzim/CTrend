import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

@ObjectType()
export class CampaignGql {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field()
  bannerText: string;

  @Field(() => String, { nullable: true })
  bannerImageUrl?: string;

  @Field()
  ctaLabel: string;

  @Field()
  ctaUrl: string;

  @Field()
  isActive: boolean;

  @Field()
  isDefault: boolean;

  @Field(() => Int)
  prizePerWinner: number;

  @Field(() => String, { nullable: true })
  rules?: string;

  @Field(() => String, { nullable: true })
  rulesBn?: string;

  @Field()
  fixturesEnabled: boolean;

  @Field(() => Date, { nullable: true })
  startDate?: Date;

  @Field(() => Date, { nullable: true })
  endDate?: Date;

  @Field()
  createdAt: Date;
}

@InputType()
export class CreateCampaignInput {
  @Field()
  @IsString()
  name: string;

  @Field()
  @IsString()
  slug: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  description?: string;

  @Field()
  @IsString()
  bannerText: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  bannerImageUrl?: string;

  @Field()
  @IsString()
  ctaLabel: string;

  @Field()
  @IsString()
  ctaUrl: string;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @Min(1)
  @IsOptional()
  prizePerWinner?: number;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  rules?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  rulesBn?: string;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  fixturesEnabled?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startDate?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endDate?: Date;
}

@InputType()
export class UpdateCampaignInput {
  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  name?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  bannerText?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  bannerImageUrl?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  ctaLabel?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  ctaUrl?: string;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @Min(1)
  @IsOptional()
  prizePerWinner?: number;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  rules?: string;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  rulesBn?: string;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  fixturesEnabled?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startDate?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endDate?: Date;
}
