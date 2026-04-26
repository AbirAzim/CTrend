import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './comment.schema';
import { CommentLike, CommentLikeDocument } from './comment-like.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { UsersService } from '../users/users.service';
import { CommentGql } from './graphql/comment.types';
import { UserDocument } from '../users/user.schema';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    @InjectModel(CommentLike.name)
    private commentLikeModel: Model<CommentLikeDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private usersService: UsersService,
  ) {}

  async create(
    userId: string,
    postId: string,
    content: string,
    parentId?: string,
  ): Promise<CommentDocument> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.commentsDisabled) {
      throw new ForbiddenException('Comments are disabled on this post');
    }
    const doc = await this.commentModel.create({
      postId: new Types.ObjectId(postId),
      userId: new Types.ObjectId(userId),
      content,
      parentId: parentId ? new Types.ObjectId(parentId) : undefined,
    });
    return doc;
  }

  async toGql(c: CommentDocument, viewerId?: string): Promise<CommentGql> {
    const author = await this.usersService.findById(c.userId.toString());
    if (!author) throw new NotFoundException('Author missing');
    const [likeCount, viewerLike] = await Promise.all([
      this.commentLikeModel.countDocuments({ commentId: c._id }).exec(),
      viewerId
        ? this.commentLikeModel
            .exists({
              commentId: c._id,
              userId: new Types.ObjectId(viewerId),
            })
            .exec()
        : Promise.resolve(null),
    ]);
    return {
      id: c._id.toHexString(),
      postId: c.postId.toHexString(),
      author: this.usersService.toGql(author as UserDocument),
      content: c.content,
      parentId: c.parentId?.toHexString(),
      likeCount,
      viewerHasLiked: !!viewerLike,
      createdAt: c.createdAt ?? new Date(),
    };
  }

  async listByPost(postId: string, viewerId?: string): Promise<CommentGql[]> {
    const rows = await this.commentModel
      .find({ postId: new Types.ObjectId(postId) })
      .sort({ createdAt: 1 })
      .exec();
    const out: CommentGql[] = [];
    for (const c of rows) {
      out.push(await this.toGql(c, viewerId));
    }
    return out;
  }

  async listMostRecentByPost(
    postId: string,
    limit = 2,
    viewerId?: string,
  ): Promise<CommentGql[]> {
    const rows = await this.commentModel
      .find({ postId: new Types.ObjectId(postId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    return Promise.all(rows.map((c) => this.toGql(c, viewerId)));
  }

  async countByPost(postId: string): Promise<number> {
    return this.commentModel
      .countDocuments({ postId: new Types.ObjectId(postId) })
      .exec();
  }

  async setCommentLike(
    userId: string,
    commentId: string,
    liked: boolean,
  ): Promise<CommentGql> {
    const comment = await this.commentModel.findById(commentId).exec();
    if (!comment) throw new NotFoundException('Comment not found');
    const uid = new Types.ObjectId(userId);
    const cid = comment._id;
    if (liked) {
      await this.commentLikeModel.updateOne(
        { commentId: cid, userId: uid },
        { $setOnInsert: { commentId: cid, userId: uid } },
        { upsert: true },
      );
    } else {
      await this.commentLikeModel.deleteOne({ commentId: cid, userId: uid });
    }
    return this.toGql(comment, userId);
  }
}
