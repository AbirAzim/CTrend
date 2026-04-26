import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentGql } from './graphql/comment.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalJwtGqlGuard } from '../common/guards/optional-jwt-gql.guard';
import { MaxLength, IsOptional, IsString } from 'class-validator';
import { Field, InputType } from '@nestjs/graphql';

type ReqUser = { id: string };

@InputType()
export class CommentPostInput {
  @Field()
  @IsString()
  @MaxLength(5000)
  content: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string;
}

@Resolver()
export class CommentsResolver {
  constructor(private commentsService: CommentsService) {}

  @Mutation(() => CommentGql)
  @UseGuards(GqlAuthGuard)
  async commentPost(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('input') input: CommentPostInput,
  ) {
    const c = await this.commentsService.create(
      user.id,
      postId,
      input.content,
      input.parentId,
    );
    return this.commentsService.toGql(c, user.id);
  }

  @Query(() => [CommentGql])
  @UseGuards(OptionalJwtGqlGuard)
  async commentsByPost(
    @Args('postId', { type: () => ID }) postId: string,
    @CurrentUser() user?: ReqUser,
  ) {
    return this.commentsService.listByPost(postId, user?.id);
  }

  @Mutation(() => CommentGql)
  @UseGuards(GqlAuthGuard)
  async setCommentLike(
    @CurrentUser() user: ReqUser,
    @Args('commentId', { type: () => ID }) commentId: string,
    @Args('liked') liked: boolean,
  ) {
    return this.commentsService.setCommentLike(user.id, commentId, liked);
  }
}
