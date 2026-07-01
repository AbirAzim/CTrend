import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PlatformSettingsGql {
  @Field()
  allowUserGlobalPosts: boolean;

  /** Minimum Android versionCode required; 0 = no force-update gate. */
  @Field(() => Int)
  minAndroidVersionCode: number;

  @Field()
  androidUpdateTitle: string;

  @Field()
  androidUpdateBody: string;

  /** Referral invites, code redemption, and referral-point awards. Default off. */
  @Field()
  referralSystemEnabled: boolean;

  /** Active UTC month key for engagement coins (`YYYY-MM`). */
  @Field()
  currentCoinMonthKey: string;
}
