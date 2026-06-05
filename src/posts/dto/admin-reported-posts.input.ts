import { Field, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

@InputType()
export class AdminReportedPostsFilterInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minReportCount?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['reportCount', 'createdAt', 'updatedAt'])
  sortBy?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;
}

@InputType()
export class AdminReportedPostsQueryInput extends AdminReportedPostsFilterInput {
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
