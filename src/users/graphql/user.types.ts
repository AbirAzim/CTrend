import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserRole } from '../../common/enums';

@ObjectType()
export class UserGql {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  /** Omitted in API response when unset (frontend may fall back to email). */
  @Field(() => String, { nullable: true })
  displayName?: string | null;

  @Field()
  username: string;

  @Field(() => [String])
  interests: string[];

  @Field(() => UserRole)
  role: UserRole;

  @Field({ nullable: true })
  bio?: string;

  @Field({ nullable: true })
  profileImageUrl?: string;
}
