import { Module } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { UploadsResolver } from './uploads.resolver';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, UploadsResolver],
})
export class UploadsModule {}
