import { Query, Resolver } from '@nestjs/graphql';
import { CategoriesService } from './categories.service';
import { CategoryGql } from './graphql/category.types';

@Resolver(() => CategoryGql)
export class CategoriesResolver {
  constructor(private categoriesService: CategoriesService) {}

  @Query(() => [CategoryGql])
  categories() {
    return this.categoriesService
      .findAll()
      .then((list) => list.map((c) => this.categoriesService.toGql(c)));
  }
}
