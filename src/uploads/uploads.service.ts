import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
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
  private _s3: S3Client | null = null;
  private _bucket: string | null = null;
  private _publicUrl: string | null = null;

  constructor(private config: ConfigService) {}

  private get s3(): S3Client {
    if (!this._s3) {
      const accountId = this.config.get<string>('CLOUDFLARE_ACCOUNT_ID');
      const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
      const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
      if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new InternalServerErrorException('R2 storage is not configured');
      }
      this._bucket = this.config.get<string>('R2_BUCKET_NAME') ?? '';
      this._publicUrl = this.config.get<string>('R2_PUBLIC_URL') ?? '';
      this._s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      });
    }
    return this._s3;
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

    const s3 = this.s3;
    const ext = CONTENT_TYPE_EXT[contentType];
    const key = `posts/${userId}/${uuidv4()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this._bucket!,
      Key: key,
      ContentType: contentType,
      ChecksumAlgorithm: undefined,
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 300,
      unhoistableHeaders: new Set(['x-amz-checksum-crc32']),
    });

    return {
      uploadUrl,
      publicUrl: `${this._publicUrl}/${key}`,
      key,
    };
  }
}
