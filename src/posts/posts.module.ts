import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from './post.schema';
import { PostReaction, PostReactionSchema } from './post-reaction.schema';
import { SavedPost, SavedPostSchema } from './saved-post.schema';
import { Comment, CommentSchema } from '../comments/comment.schema';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { CategoriesModule } from '../categories/categories.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { VotesModule } from '../votes/votes.module';
import { CommentsModule } from '../comments/comments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: PostReaction.name, schema: PostReactionSchema },
      { name: SavedPost.name, schema: SavedPostSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
    CategoriesModule,
    OrganizationsModule,
    UsersModule,
    VotesModule,
    CommentsModule,
  ],
  providers: [PostsService, PostsResolver],
  exports: [PostsService],
})
export class PostsModule {}
