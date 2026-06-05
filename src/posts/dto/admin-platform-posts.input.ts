import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PostStatus } from '../../common/enums';

@InputType()
export class AdminPlatformPostsFilterInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => PostStatus, { nullable: true })
  @IsOptional()
  status?: PostStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** `live` | `closed` | omit for all */
  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['live', 'closed'])
  votingFilter?: string;

  /**
   * Which platform-wide posts to manage:
   * `admin` (default) → admin SYSTEM posts; `user` → normal-user posts that were
   * broadcast platform-wide (`isUserGlobalBroadcast`).
   */
  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['admin', 'user'])
  scope?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['createdAt', 'votes', 'caption', 'updatedAt'])
  sortBy?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;
}

@InputType()
export class AdminPlatformPostsQueryInput extends AdminPlatformPostsFilterInput {
  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @Field(() => Int, { nullable: true, defaultValue: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
