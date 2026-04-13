import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from '../posts/post.schema';
import { User, UserSchema } from '../users/user.schema';
import { CategoriesModule } from '../categories/categories.module';
import { SeedDummyPostsService } from './seed-dummy-posts.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CategoriesModule,
  ],
  providers: [SeedDummyPostsService],
})
export class SeedModule {}
