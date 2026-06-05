import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PlatformSettingsGql {
  @Field()
  allowUserGlobalPosts: boolean;
}
