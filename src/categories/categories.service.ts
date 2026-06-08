import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './category.schema';
import { CategoryGql } from './graphql/category.types';
import { Post, PostDocument } from '../posts/post.schema';

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
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async createCategory(name: string): Promise<CategoryDocument> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Name is required');
    const slug = this.slugify(trimmed);
    if (!slug) throw new BadRequestException('Name is invalid');
    const exists = await this.categoryModel.findOne({
      $or: [{ slug }, { name: trimmed }],
    });
    if (exists) throw new ConflictException('Category already exists');
    return this.categoryModel.create({ name: trimmed, slug });
  }

  async updateCategory(
    id: string,
    name: string,
    color?: string,
  ): Promise<CategoryDocument> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Name is required');
    const slug = this.slugify(trimmed);
    if (!slug) throw new BadRequestException('Name is invalid');
    const cat = await this.categoryModel.findById(id).exec();
    if (!cat) throw new NotFoundException('Category not found');
    const dup = await this.categoryModel
      .findOne({ _id: { $ne: cat._id }, $or: [{ slug }, { name: trimmed }] })
      .exec();
    if (dup) throw new ConflictException('Another category has this name');
    cat.name = trimmed;
    cat.slug = slug;
    // `color` undefined = leave unchanged; empty string = clear (auto color);
    // otherwise must be a #RGB / #RRGGBB hex value.
    if (color !== undefined) {
      const c = color.trim();
      if (c === '') {
        cat.color = undefined;
      } else if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
        cat.color = c.toLowerCase();
      } else {
        throw new BadRequestException('Color must be a hex value like #6366f1');
      }
    }
    return cat.save();
  }

  async deleteCategory(id: string): Promise<boolean> {
    const cat = await this.categoryModel.findById(id).exec();
    if (!cat) throw new NotFoundException('Category not found');
    const postsUsing = await this.postModel
      .countDocuments({ categoryId: new Types.ObjectId(id) })
      .exec();
    if (postsUsing > 0) {
      throw new ConflictException(
        `Cannot delete: ${postsUsing} post${postsUsing === 1 ? '' : 's'} use this category. Reassign or delete them first.`,
      );
    }
    await this.categoryModel.deleteOne({ _id: cat._id }).exec();
    return true;
  }

  async getPostCount(categoryId: string): Promise<number> {
    return this.postModel.countDocuments({
      categoryId: new Types.ObjectId(categoryId),
    });
  }

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
      color: doc.color ?? undefined,
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
