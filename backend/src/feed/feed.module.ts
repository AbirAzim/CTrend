import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from '../posts/post.schema';
import { FeedService } from './feed.service';
import { FeedResolver } from './feed.resolver';
import { NewPostsResolver } from './new-posts.resolver';
import { PostsModule } from '../posts/posts.module';
import { CategoriesModule } from '../categories/categories.module';
import { FollowsModule } from '../follows/follows.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Post.name, schema: PostSchema }]),
    PostsModule,
    CategoriesModule,
    FollowsModule,
    OrganizationsModule,
    UsersModule,
  ],
  providers: [FeedService, FeedResolver, NewPostsResolver],
})
export class FeedModule {}
