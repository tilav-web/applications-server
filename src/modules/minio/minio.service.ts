import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as Minio from 'minio';
import { extname } from 'path';

export interface UploadedFileResponse {
  url: string;
  key: string;
  filename: string;
  original_name: string;
  size: number;
  mimetype: string;
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient!: Minio.Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME', 'uvd-attachments');
  }

  async onModuleInit(): Promise<void> {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = Number(this.configService.get<number>('MINIO_PORT', 9200));
    const accessKey = this.configService.get<string>('MINIO_ROOT_USER', 'minioadmin');
    const secretKey = this.configService.get<string>('MINIO_ROOT_PASSWORD', 'minioadmin123');

    if (isProduction && (!secretKey || secretKey === 'minioadmin123')) {
      throw new Error(
        'XAVFSIZLIK XATOLIGI: Production muhitida MINIO_ROOT_PASSWORD kuchli parol bilan sozlanishi shart!',
      );
    }

    this.minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL: this.configService.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey,
      secretKey,
    });

    try {
      const bucketExists = await this.minioClient.bucketExists(this.bucketName);
      if (!bucketExists) {
        await this.minioClient.makeBucket(this.bucketName);
        this.logger.log(`MinIO private bucket '${this.bucketName}' yaratildi.`);
      }
      // Xavfsizlik: Bucket ommaviy (public) qilinmaydi — barcha fayllar faqat autentifikatsiya orqali beriladi
      this.logger.log(`MinIO xizmati muvaffaqiyatli ulandi (${endPoint}:${port}).`);
    } catch (err) {
      this.logger.error(`MinIO ulanishida xatolik:`, err);
    }
  }

  private sanitizeFolder(folder: string): string {
    const cleaned = folder
      .split('/')
      .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, ''))
      .filter(Boolean)
      .join('/');
    return cleaned || 'attachments';
  }

  async uploadFile(
    file: Express.Multer.File,
    folder = 'attachments',
  ): Promise<UploadedFileResponse> {
    const safeFolder = this.sanitizeFolder(folder);
    const ext = extname(file.originalname)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    const cleanName = file.originalname
      .replace(extname(file.originalname), '')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeFolder}/${Date.now()}_${cleanName}_${randomUUID().slice(0, 8)}${ext}`;

    const metaData = {
      'Content-Type': file.mimetype,
      'Original-Name': encodeURIComponent(file.originalname),
    };

    await this.minioClient.putObject(this.bucketName, filename, file.buffer, file.size, metaData);

    const endPoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = Number(this.configService.get<number>('MINIO_PORT', 9200));
    const directUrl = `http://${endPoint}:${port}/${this.bucketName}/${filename}`;

    return {
      url: directUrl,
      key: filename,
      filename,
      original_name: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    };
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    originalName = 'document.docx',
  ): Promise<UploadedFileResponse> {
    const metaData = {
      'Content-Type': mimetype,
      'Original-Name': encodeURIComponent(originalName),
    };

    await this.minioClient.putObject(this.bucketName, filename, buffer, buffer.length, metaData);

    const endPoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = Number(this.configService.get<number>('MINIO_PORT', 9200));
    const directUrl = `http://${endPoint}:${port}/${this.bucketName}/${filename}`;

    return {
      url: directUrl,
      key: filename,
      filename,
      original_name: originalName,
      size: buffer.length,
      mimetype,
    };
  }

  async uploadMultipleFiles(
    files: Express.Multer.File[],
    folder = 'attachments',
  ): Promise<UploadedFileResponse[]> {
    const results: UploadedFileResponse[] = [];
    for (const file of files) {
      const res = await this.uploadFile(file, folder);
      results.push(res);
    }
    return results;
  }

  async getFileStream(key: string) {
    return this.minioClient.getObject(this.bucketName, key);
  }

  async getStat(key: string) {
    return this.minioClient.statObject(this.bucketName, key);
  }

  async deleteFile(key: string): Promise<void> {
    await this.minioClient.removeObject(this.bucketName, key);
  }
}
