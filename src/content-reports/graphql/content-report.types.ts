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

  @Field({ nullable: true })
  details?: string;

  @Field(() => ID)
  reporterId: string;

  @Field({ nullable: true })
  reporterUsername?: string;

  @Field({ nullable: true })
  reporterDisplayName?: string | null;

  @Field({ nullable: true })
  contextUrl?: string;

  @Field()
  createdAt: Date;
}
