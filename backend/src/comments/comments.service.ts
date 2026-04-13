import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './comment.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { UsersService } from '../users/users.service';
import { CommentGql } from './graphql/comment.types';
import { UserDocument } from '../users/user.schema';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
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

  async toGql(c: CommentDocument): Promise<CommentGql> {
    const author = await this.usersService.findById(c.userId.toString());
    if (!author) throw new NotFoundException('Author missing');
    return {
      id: c._id.toHexString(),
      postId: c.postId.toHexString(),
      author: this.usersService.toGql(author as UserDocument),
      content: c.content,
      parentId: c.parentId?.toHexString(),
      createdAt: c.createdAt ?? new Date(),
    };
  }

  async listByPost(postId: string): Promise<CommentGql[]> {
    const rows = await this.commentModel
      .find({ postId: new Types.ObjectId(postId) })
      .sort({ createdAt: 1 })
      .exec();
    const out: CommentGql[] = [];
    for (const c of rows) {
      out.push(await this.toGql(c));
    }
    return out;
  }
}
