import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Follow, FollowSchema } from './follow.schema';
import { FollowsService } from './follows.service';
import { FollowsResolver } from './follows.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Follow.name, schema: FollowSchema }]),
  ],
  providers: [FollowsService, FollowsResolver],
  exports: [FollowsService],
})
export class FollowsModule {}
