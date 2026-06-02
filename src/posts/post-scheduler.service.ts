import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Connection } from 'mongoose';
import { PostsService } from './posts.service';

@Injectable()
export class PostSchedulerService {
  private readonly logger = new Logger(PostSchedulerService.name);
  private readonly disabled: boolean;

  constructor(
    private readonly postsService: PostsService,
    private readonly config: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {
    this.disabled =
      this.config.get<string>('DISABLE_POST_SCHEDULER') === 'true';
    if (this.disabled) {
      this.logger.warn('Post scheduler disabled (DISABLE_POST_SCHEDULER=true)');
    }
  }

  @Cron('* * * * *')
  async publishDuePosts() {
    if (this.disabled) return;

    try {
      if (this.connection.readyState !== 1) {
        this.logger.warn(
          `MongoDB connection is not ready (readyState=${this.connection.readyState}); attempting scheduled publish anyway`,
        );
      }
      await this.postsService.publishScheduledPosts();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('timed out') ||
        message.includes('MongoServerSelectionError')
      ) {
        this.logger.warn(
          'Scheduled publish skipped — MongoDB unreachable. Check Atlas Network Access (IP whitelist) and internet.',
        );
        return;
      }
      this.logger.error('Failed to publish scheduled posts', err);
    }
  }
}
