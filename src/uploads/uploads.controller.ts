import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

// 10 MB raw input cap — after compression the output will be ≤ 400 KB.
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

@Controller('uploads')
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  /**
   * POST /uploads/image
   * Multipart field: file
   * Auth: Bearer token
   *
   * Accepts any image up to 10 MB, compresses to ≤ 400 KB, uploads to R2,
   * and returns { publicUrl, key }.
   */
  @Post('image')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_INPUT_BYTES } }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: { id: string } },
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}`,
      );
    }

    const { buffer, mimeType } = await this.uploadsService.compressImage(
      file.buffer,
      file.mimetype,
    );

    return this.uploadsService.uploadBuffer(buffer, mimeType, req.user.id);
  }
}
