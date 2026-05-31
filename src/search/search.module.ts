import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/user.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { SearchService } from './search.service';
import { SearchResolver } from './search.resolver';
import { UsersModule } from '../users/users.module';
import { PostsModule } from '../posts/posts.module';
import { FollowsModule } from '../follows/follows.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Post.name, schema: PostSchema },
    ]),
    UsersModule,
    PostsModule,
    FollowsModule,
  ],
  providers: [SearchService, SearchResolver],
})
export class SearchModule {}
