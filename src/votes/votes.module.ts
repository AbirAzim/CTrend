import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Vote, VoteSchema } from './vote.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { VotesService } from './votes.service';
import { VotesResolver } from './votes.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vote.name, schema: VoteSchema },
      { name: Post.name, schema: PostSchema },
    ]),
  ],
  providers: [VotesService, VotesResolver],
  exports: [VotesService],
})
export class VotesModule {}
