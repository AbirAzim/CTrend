import { Field, ID, ObjectType } from '@nestjs/graphql';
import { InvitationStatus, UserRole } from '../../common/enums';

@ObjectType()
export class InvitationGql {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field(() => UserRole)
  role: UserRole;

  @Field(() => InvitationStatus)
  status: InvitationStatus;

  @Field()
  expiresAt: Date;

  @Field()
  createdAt: Date;
}
