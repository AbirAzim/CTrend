import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CategoryGql {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;
}
