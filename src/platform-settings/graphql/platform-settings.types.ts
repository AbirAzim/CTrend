import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PlatformSettingsGql {
  @Field()
  allowUserGlobalPosts: boolean;

  /** Minimum Android versionCode required; 0 = no force-update gate. */
  @Field(() => Int)
  minAndroidVersionCode: number;
}
