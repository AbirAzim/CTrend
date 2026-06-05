import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ContentReportsService } from './content-reports.service';
import { ContentReportGql } from './graphql/content-report.types';
import { ReportContentInput } from './dto/report-content.input';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

type ReqUser = { id: string; role: string };

@Resolver(() => ContentReportGql)
export class ContentReportsResolver {
  constructor(private readonly contentReportsService: ContentReportsService) {}

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async reportContent(
    @CurrentUser() user: ReqUser,
    @Args('input') input: ReportContentInput,
  ) {
    return this.contentReportsService.reportContent(user.id, input);
  }

  @Query(() => [ContentReportGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminContentReports(
    @Args('postId', { type: () => ID }) postId: string,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 50 })
    take?: number,
  ) {
    return this.contentReportsService.listReportsForPostAdmin(
      postId,
      skip,
      take,
    );
  }

  @Query(() => Int)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminContentReportsCount(
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    return this.contentReportsService.countReportsForPostAdmin(postId);
  }
}
