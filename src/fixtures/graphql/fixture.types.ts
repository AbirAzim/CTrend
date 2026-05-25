import { Field, ID, Int, ObjectType, InputType } from '@nestjs/graphql';

@ObjectType()
export class FixtureTeamGql {
  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  shortName?: string | null;

  @Field(() => String, { nullable: true })
  crest?: string | null;
}

@ObjectType()
export class FixtureScoreGql {
  @Field(() => Int, { nullable: true })
  home?: number | null;

  @Field(() => Int, { nullable: true })
  away?: number | null;

  @Field(() => String, { nullable: true })
  winner?: string | null;
}

@ObjectType()
export class FixtureVenueGql {
  @Field()
  name: string;

  @Field()
  city: string;
}

@ObjectType()
export class FixtureGql {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  externalId: number;

  @Field(() => FixtureTeamGql)
  homeTeam: FixtureTeamGql;

  @Field(() => FixtureTeamGql)
  awayTeam: FixtureTeamGql;

  @Field()
  kickoff: Date;

  @Field()
  status: string;

  @Field()
  stage: string;

  @Field(() => String, { nullable: true })
  group?: string;

  @Field(() => Int, { nullable: true })
  matchday?: number;

  @Field(() => FixtureScoreGql)
  score: FixtureScoreGql;

  @Field(() => FixtureVenueGql, { nullable: true })
  venue?: FixtureVenueGql;

  /** ID of the campaign post created for this fixture, if any */
  @Field(() => ID, { nullable: true })
  campaignPostId?: string;
}

@InputType()
export class FixtureFilterInput {
  @Field(() => String, { nullable: true })
  stage?: string;

  @Field(() => String, { nullable: true })
  group?: string;
}
