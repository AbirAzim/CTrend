import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ContentReport,
  ContentReportDocument,
} from './content-report.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { ReportContentInput } from './dto/report-content.input';
import {
  ContentReportReasonId,
  ContentReportTargetType,
} from '../common/enums';
import { ContentReportGql } from './graphql/content-report.types';
import { UsersService } from '../users/users.service';

const REASON_LABELS: Record<ContentReportReasonId, string> = {
  [ContentReportReasonId.SPAM]: 'Spam or misleading',
  [ContentReportReasonId.HARASSMENT]: 'Harassment or hate',
  [ContentReportReasonId.VIOLENCE]: 'Violence or dangerous content',
  [ContentReportReasonId.NUDITY]: 'Nudity or sexual content',
  [ContentReportReasonId.COPYRIGHT]: 'Copyright or impersonation',
  [ContentReportReasonId.OTHER]: 'Other',
};

@Injectable()
export class ContentReportsService {
  constructor(
    @InjectModel(ContentReport.name)
    private readonly reportModel: Model<ContentReportDocument>,
    @InjectModel(Post.name)
    private readonly postModel: Model<PostDocument>,
    private readonly usersService: UsersService,
  ) {}

  async reportContent(
    reporterId: string,
    input: ReportContentInput,
  ): Promise<boolean> {
    if (input.targetType !== ContentReportTargetType.POST) {
      throw new BadRequestException('Only post reports are supported for now');
    }
    if (!Types.ObjectId.isValid(input.targetId)) {
      throw new NotFoundException('Post not found');
    }
    const post = await this.postModel.findById(input.targetId).exec();
    if (!post) throw new NotFoundException('Post not found');

    const reporterOid = new Types.ObjectId(reporterId);
    const targetOid = new Types.ObjectId(input.targetId);

    try {
      await this.reportModel.create({
        targetType: input.targetType,
        targetId: targetOid,
        reasonId: input.reasonId,
        details: input.details?.trim() || undefined,
        reporterId: reporterOid,
        contextUrl: input.contextUrl?.trim() || undefined,
      });
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 11000) {
        throw new ConflictException('You already reported this post');
      }
      throw err;
    }

    await this.postModel
      .updateOne({ _id: targetOid }, { $inc: { reportCount: 1 } })
      .exec();

    return true;
  }

  async listReportsForPostAdmin(
    postId: string,
    skip = 0,
    take = 50,
  ): Promise<ContentReportGql[]> {
    if (!Types.ObjectId.isValid(postId)) return [];
    const safeTake = Math.min(100, Math.max(1, take));
    const rows = await this.reportModel
      .find({
        targetType: ContentReportTargetType.POST,
        targetId: new Types.ObjectId(postId),
      })
      .sort({ createdAt: -1 })
      .skip(Math.max(0, skip))
      .limit(safeTake)
      .exec();

    const reporterIds = [
      ...new Set(rows.map((r) => r.reporterId.toHexString())),
    ];
    const reporters = await this.usersService.findByIds(reporterIds);
    const byReporterId = new Map(
      reporters.map((u) => [u._id.toHexString(), u] as const),
    );

    return rows.map((row) => {
      const reporter = byReporterId.get(row.reporterId.toHexString());
      return {
        id: row._id.toHexString(),
        targetType: row.targetType,
        targetId: row.targetId.toHexString(),
        reasonId: row.reasonId,
        details: row.details,
        reporterId: row.reporterId.toHexString(),
        reporterUsername: reporter?.username,
        reporterDisplayName: reporter?.displayName ?? null,
        contextUrl: row.contextUrl,
        createdAt: row.createdAt,
      };
    });
  }

  async countReportsForPostAdmin(postId: string): Promise<number> {
    if (!Types.ObjectId.isValid(postId)) return 0;
    return this.reportModel
      .countDocuments({
        targetType: ContentReportTargetType.POST,
        targetId: new Types.ObjectId(postId),
      })
      .exec();
  }

  async deleteReportsForPost(postId: string): Promise<void> {
    if (!Types.ObjectId.isValid(postId)) return;
    await this.reportModel
      .deleteMany({
        targetType: ContentReportTargetType.POST,
        targetId: new Types.ObjectId(postId),
      })
      .exec();
  }

  static reasonLabel(reasonId: ContentReportReasonId): string {
    return REASON_LABELS[reasonId] ?? reasonId;
  }
}
