import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CategoryGql {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  // Admin-assigned accent color (hex). Null when unset — frontend falls back
  // to a deterministic per-category color.
  @Field({ nullable: true })
  color?: string;
}
