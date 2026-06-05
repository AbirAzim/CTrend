import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ContentReportReasonId,
  ContentReportTargetType,
} from '../../common/enums';

@InputType()
export class ReportContentInput {
  @Field(() => ContentReportTargetType)
  @IsEnum(ContentReportTargetType)
  targetType: ContentReportTargetType;

  @Field(() => ID)
  @IsString()
  targetId: string;

  @Field(() => ContentReportReasonId)
  @IsEnum(ContentReportReasonId)
  reasonId: ContentReportReasonId;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  contextUrl?: string;
}
