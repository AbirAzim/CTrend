import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, CategoryDocument } from './category.schema';
import { CategoryGql } from './graphql/category.types';

const DEFAULT_CATEGORIES = [
  { name: 'Tech', slug: 'tech' },
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Food', slug: 'food' },
  { name: 'Sports', slug: 'sports' },
  { name: 'Entertainment', slug: 'entertainment' },
];

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
  ) {}

  async onModuleInit() {
    for (const c of DEFAULT_CATEGORIES) {
      await this.categoryModel.updateOne(
        { slug: c.slug },
        { $setOnInsert: { name: c.name, slug: c.slug } },
        { upsert: true },
      );
    }
  }

  toGql(doc: CategoryDocument): CategoryGql {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      slug: doc.slug,
    };
  }

  async findAll(): Promise<CategoryDocument[]> {
    return this.categoryModel.find().sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<CategoryDocument | null> {
    return this.categoryModel.findById(id).exec();
  }

  async findBySlug(slug: string): Promise<CategoryDocument | null> {
    return this.categoryModel.findOne({ slug: slug.toLowerCase() }).exec();
  }
}
