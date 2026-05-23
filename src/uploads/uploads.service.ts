import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

@Injectable()
export class UploadsService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private config: ConfigService) {
    const accountId = config.getOrThrow<string>('CLOUDFLARE_ACCOUNT_ID');
    this.bucket = config.getOrThrow<string>('R2_BUCKET_NAME');
    this.publicUrl = config.getOrThrow<string>('R2_PUBLIC_URL');

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  async getImageUploadUrl(
    userId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(
        `Unsupported content type: ${contentType}. Allowed: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`,
      );
    }

    const ext = CONTENT_TYPE_EXT[contentType];
    const key = `posts/${userId}/${uuidv4()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 300 });

    return {
      uploadUrl,
      publicUrl: `${this.publicUrl}/${key}`,
      key,
    };
  }
}
