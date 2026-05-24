import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from '../posts/post.schema';
import { User, UserSchema } from '../users/user.schema';
import { CategoriesModule } from '../categories/categories.module';
import { UsersModule } from '../users/users.module';
import { SeedDummyPostsService } from './seed-dummy-posts.service';
import { AdminSeedService } from './admin-seed.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CategoriesModule,
    UsersModule,
  ],
  providers: [SeedDummyPostsService, AdminSeedService],
})
export class SeedModule {}
