import { Field, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

@ObjectType()
export class AuthPayloadGql {
  @Field()
  accessToken: string;

  @Field(() => UserGql)
  user: UserGql;
}
