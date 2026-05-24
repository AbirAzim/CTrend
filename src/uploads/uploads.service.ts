import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import * as sharp from 'sharp';

const MAX_BYTES = 400 * 1024; // 400 KB

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
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
    }
    return this._s3;
  }

  /**
   * Compress an image buffer to ≤ 400 KB.
   * GIFs are returned as-is (animated GIF compression is lossy and complex).
   * All other types are converted to WebP with iteratively reduced quality,
   * then progressively resized if quality reduction alone isn't enough.
   */
  async compressImage(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (buffer.length <= MAX_BYTES) {
      return { buffer, mimeType };
    }

    if (mimeType === 'image/gif') {
      // GIF: reject if over limit — animated GIF recompression changes behaviour too much.
      throw new BadRequestException(
        'GIF exceeds 400 KB. Please upload a smaller file.',
      );
    }

    // Try WebP at decreasing quality levels.
    for (let quality = 82; quality >= 20; quality -= 12) {
      const compressed = await sharp(buffer).webp({ quality }).toBuffer();
      if (compressed.length <= MAX_BYTES) {
        return { buffer: compressed, mimeType: 'image/webp' };
      }
    }

    // Still over limit — resize to at most 1280px on the longest side and retry.
    for (let quality = 75; quality >= 20; quality -= 15) {
      const compressed = await sharp(buffer)
        .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      if (compressed.length <= MAX_BYTES) {
        return { buffer: compressed, mimeType: 'image/webp' };
      }
    }

    throw new BadRequestException(
      'Image could not be compressed below 400 KB. Please use a smaller image.',
    );
  }

  /** Upload a buffer directly to R2 and return the public URL. */
  async uploadBuffer(
    buffer: Buffer,
    mimeType: string,
    userId: string,
  ): Promise<{ publicUrl: string; key: string }> {
    const s3 = this.s3;
    const ext = CONTENT_TYPE_EXT[mimeType] ?? 'webp';
    const key = `posts/${userId}/${uuidv4()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: this._bucket!,
        Key: key,
        ContentType: mimeType,
        Body: buffer,
        ContentLength: buffer.length,
        ChecksumAlgorithm: undefined,
      }),
    );

    return { publicUrl: `${this._publicUrl}/${key}`, key };
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
