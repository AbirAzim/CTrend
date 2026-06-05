import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ContentReport,
  ContentReportSchema,
} from './content-report.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { ContentReportsService } from './content-reports.service';
import { ContentReportsResolver } from './content-reports.resolver';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContentReport.name, schema: ContentReportSchema },
      { name: Post.name, schema: PostSchema },
    ]),
    UsersModule,
  ],
  providers: [ContentReportsService, ContentReportsResolver],
  exports: [ContentReportsService],
})
export class ContentReportsModule {}
