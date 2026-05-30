import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from './category.schema';
import { CategoriesService } from './categories.service';
import { CategoriesResolver } from './categories.resolver';
import { Post, PostSchema } from '../posts/post.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Post.name, schema: PostSchema },
    ]),
  ],
  providers: [CategoriesService, CategoriesResolver],
  exports: [CategoriesService],
})
export class CategoriesModule {}
