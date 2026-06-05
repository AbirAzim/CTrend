import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  ContentReportReasonId,
  ContentReportTargetType,
} from '../../common/enums';

@ObjectType()
export class ContentReportGql {
  @Field(() => ID)
  id: string;

  @Field(() => ContentReportTargetType)
  targetType: ContentReportTargetType;

  @Field(() => ID)
  targetId: string;

  @Field(() => ContentReportReasonId)
  reasonId: ContentReportReasonId;

  @Field(() => String, { nullable: true })
  details?: string;

  @Field(() => ID)
  reporterId: string;

  @Field(() => String, { nullable: true })
  reporterUsername?: string;

  @Field(() => String, { nullable: true })
  reporterDisplayName?: string | null;

  @Field(() => String, { nullable: true })
  contextUrl?: string;

  @Field()
  createdAt: Date;
}
