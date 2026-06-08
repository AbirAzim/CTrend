import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoryGql } from './graphql/category.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@Resolver(() => CategoryGql)
export class CategoriesResolver {
  constructor(private categoriesService: CategoriesService) {}

  @Query(() => [CategoryGql])
  categories() {
    return this.categoriesService
      .findAll()
      .then((list) => list.map((c) => this.categoriesService.toGql(c)));
  }

  // Alias for clients that expect an explicit "fetch all" API name
  @Query(() => [CategoryGql])
  getAllCategories() {
    return this.categoriesService
      .findAll()
      .then((list) => list.map((c) => this.categoriesService.toGql(c)));
  }

  @Query(() => Int)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async categoryPostCount(
    @Args('categoryId', { type: () => ID }) categoryId: string,
  ): Promise<number> {
    return this.categoriesService.getPostCount(categoryId);
  }

  @Mutation(() => CategoryGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createCategory(@Args('name') name: string) {
    const doc = await this.categoriesService.createCategory(name);
    return this.categoriesService.toGql(doc);
  }

  @Mutation(() => CategoryGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateCategory(
    @Args('id', { type: () => ID }) id: string,
    @Args('name') name: string,
    @Args('color', { nullable: true }) color?: string,
  ) {
    const doc = await this.categoriesService.updateCategory(id, name, color);
    return this.categoriesService.toGql(doc);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteCategory(@Args('id', { type: () => ID }) id: string) {
    return this.categoriesService.deleteCategory(id);
  }
}
