import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AdminDailyStatGql {
  @Field()
  date: string;

  @Field(() => Int)
  signups: number;

  @Field(() => Int)
  posts: number;

  @Field(() => Int)
  votes: number;

  @Field(() => Int)
  comments: number;
}

@ObjectType()
export class AdminPlatformStatsGql {
  @Field(() => Int)
  totalUsers: number;

  @Field(() => Int)
  totalAdmins: number;

  @Field(() => Int)
  verifiedUsers: number;

  @Field(() => Int)
  onlineUsers: number;

  @Field(() => Int)
  newUsersLast7Days: number;

  @Field(() => Int)
  totalPosts: number;

  @Field(() => Int)
  totalVotes: number;

  @Field(() => Int)
  totalComments: number;

  @Field(() => Int)
  activeVotersLast7Days: number;

  @Field(() => Int)
  postsLast7Days: number;

  @Field(() => Int)
  votesLast7Days: number;

  @Field(() => Int)
  pendingInvitations: number;

  @Field(() => Int)
  reportedPosts: number;

  @Field(() => Int)
  campaignWinners: number;

  @Field(() => [AdminDailyStatGql])
  dailyActivity: AdminDailyStatGql[];
}
