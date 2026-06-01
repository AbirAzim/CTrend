import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Vote, VoteSchema } from './vote.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { Follow, FollowSchema } from '../follows/follow.schema';
import { VotesService } from './votes.service';
import { VotesResolver } from './votes.resolver';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vote.name, schema: VoteSchema },
      { name: Post.name, schema: PostSchema },
      { name: Follow.name, schema: FollowSchema },
    ]),
    UsersModule,
    forwardRef(() => NotificationsModule),
  ],
  providers: [VotesService, VotesResolver],
  exports: [VotesService],
})
export class VotesModule {}
