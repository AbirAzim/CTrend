import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/user.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { Vote, VoteDocument } from '../votes/vote.schema';
import { Comment, CommentDocument } from '../comments/comment.schema';
import {
  Invitation,
  InvitationDocument,
} from '../invitations/invitation.schema';
import {
  ContentReport,
  ContentReportDocument,
} from '../content-reports/content-report.schema';
import {
  CampaignWinner,
  CampaignWinnerDocument,
} from '../world-cup-campaign/campaign-winner.schema';
import { InvitationStatus, UserRole } from '../common/enums';
import { ContentReportTargetType } from '../common/enums';
import { PresenceService } from '../presence/presence.service';
import {
  AdminDailyStatGql,
  AdminPlatformStatsGql,
} from './graphql/admin-analytics.types';

const ACTIVITY_DAYS = 14;

/** Pure platform users (excludes admin-role accounts). */
const USER_FILTER = {
  $and: [
    { $or: [{ roles: 'user' }, { role: 'user' }] },
    { $nor: [{ roles: 'admin' }, { role: 'admin' }] },
  ],
};

const ADMIN_FILTER = {
  $or: [{ roles: UserRole.ADMIN }, { role: UserRole.ADMIN }],
};

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBack(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function buildDayRange(): string[] {
  const keys: string[] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    keys.push(utcDayKey(daysBack(i)));
  }
  return keys;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
    @InjectModel(ContentReport.name)
    private contentReportModel: Model<ContentReportDocument>,
    @InjectModel(CampaignWinner.name)
    private campaignWinnerModel: Model<CampaignWinnerDocument>,
    private presenceService: PresenceService,
  ) {}

  private async countByDay(
    model: Model<{ createdAt?: Date }>,
    since: Date,
  ): Promise<Map<string, number>> {
    const rows = await model.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    return new Map(rows.map((r) => [r._id, r.count]));
  }

  async getPlatformStats(): Promise<AdminPlatformStatsGql> {
    const since = daysBack(ACTIVITY_DAYS - 1);
    const last7 = daysBack(6);

    const userFilter = USER_FILTER;
    const adminFilter = ADMIN_FILTER;

    const [
      totalUsers,
      totalAdmins,
      verifiedUsers,
      newUsersLast7Days,
      totalPosts,
      totalVotes,
      totalComments,
      postsLast7Days,
      votesLast7Days,
      activeVotersLast7Days,
      pendingInvitations,
      reportedPosts,
      campaignWinners,
      signupsByDay,
      postsByDay,
      votesByDay,
      commentsByDay,
    ] = await Promise.all([
      this.userModel.countDocuments(userFilter).exec(),
      this.userModel.countDocuments(adminFilter).exec(),
      this.userModel.countDocuments({ ...userFilter, emailVerified: true }).exec(),
      this.userModel
        .countDocuments({ ...userFilter, createdAt: { $gte: last7 } })
        .exec(),
      this.postModel.countDocuments().exec(),
      this.voteModel.countDocuments().exec(),
      this.commentModel.countDocuments().exec(),
      this.postModel.countDocuments({ createdAt: { $gte: last7 } }).exec(),
      this.voteModel.countDocuments({ createdAt: { $gte: last7 } }).exec(),
      this.voteModel
        .distinct('userId', { createdAt: { $gte: last7 } })
        .then((ids) => ids.length),
      this.invitationModel
        .countDocuments({ status: InvitationStatus.PENDING })
        .exec(),
      this.contentReportModel
        .aggregate<{ count: number }>([
          {
            $match: { targetType: ContentReportTargetType.POST },
          },
          { $group: { _id: '$targetId' } },
          { $count: 'count' },
        ])
        .then((r) => r[0]?.count ?? 0),
      this.campaignWinnerModel
        .countDocuments({ userId: { $ne: null } })
        .exec(),
      this.countByDay(this.userModel, since),
      this.countByDay(this.postModel, since),
      this.countByDay(this.voteModel, since),
      this.countByDay(this.commentModel, since),
    ]);

    const dayKeys = buildDayRange();
    const dailyActivity: AdminDailyStatGql[] = dayKeys.map((date) => ({
      date,
      signups: signupsByDay.get(date) ?? 0,
      posts: postsByDay.get(date) ?? 0,
      votes: votesByDay.get(date) ?? 0,
      comments: commentsByDay.get(date) ?? 0,
    }));

    return {
      totalUsers,
      totalAdmins,
      verifiedUsers,
      onlineUsers: this.presenceService.onlineUserIds().length,
      newUsersLast7Days,
      totalPosts,
      totalVotes,
      totalComments,
      activeVotersLast7Days,
      postsLast7Days,
      votesLast7Days,
      pendingInvitations,
      reportedPosts,
      campaignWinners,
      dailyActivity,
    };
  }
}
