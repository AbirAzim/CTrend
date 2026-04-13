import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserRole } from '../../common/enums';

@ObjectType()
export class UserGql {
  @Field(() => ID)
  id: string;

  @Field()
  username: string;

  @Field()
  email: string;

  @Field(() => [String])
  interests: string[];

  @Field(() => UserRole)
  role: UserRole;

  @Field({ nullable: true })
  bio?: string;

  @Field({ nullable: true })
  profileImageUrl?: string;
}
