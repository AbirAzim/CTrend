import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostsService } from './posts.service';

@Injectable()
export class PostSchedulerService {
  private readonly logger = new Logger(PostSchedulerService.name);

  constructor(private readonly postsService: PostsService) {}

  @Cron('* * * * *')
  async publishDuePosts() {
    try {
      await this.postsService.publishScheduledPosts();
    } catch (err) {
      this.logger.error('Failed to publish scheduled posts', err);
    }
  }
}
