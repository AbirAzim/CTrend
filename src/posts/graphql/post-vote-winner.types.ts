import { Field, Int, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

/** Random draw winner after voting closes (non-anonymous voters on winning side(s)). */
@ObjectType()
export class PostVoteWinnerGql {
  @Field(() => UserGql, { nullable: true })
  user?: UserGql | null;

  /** Option index the winner voted for. */
  @Field(() => Int, { nullable: true })
  selectedOptionIndex?: number | null;

  @Field(() => Date, { nullable: true })
  pickedAt?: Date | null;
}
