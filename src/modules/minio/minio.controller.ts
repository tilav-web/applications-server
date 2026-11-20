import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { extname } from 'path';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MinioService } from './minio.service';

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
  '.csv',
  '.zip',
  '.rar',
  '.mp3',
  '.mp4',
  '.ogg',
  '.wav',
]);

// Brauzerda xavfsiz (XSS keltirib chiqarmaydigan) inline ko'rsatish mumkin bo'lgan MIME turlar
const SAFE_INLINE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const uploadMulterOptions = {
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
  },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const ext = extname(file.originalname || '').toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      cb(
        new BadRequestException(
          `Ushbu fayl turi (${ext || 'noma’lum'}) xavfsizlik sababli yuklashga ruxsat etilmaydi`,
        ),
        false,
      );
      return;
    }
    cb(null, true);
  },
};

function sanitizeDownloadFilename(name: string): string {
  return (
    name
      .replace(/[\r\n"\\]/g, '_')
      .replace(/[^\x20-\x7E\u0400-\u04FF]/g, '_')
      .trim() || 'file'
  );
}

@Controller('files')
@UseGuards(JwtAuthGuard)
export class MinioController {
  constructor(private readonly minioService: MinioService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', uploadMulterOptions))
  async uploadSingle(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('Fayl yuborilmadi');
    }
    const folder = (req.query.folder as string) || 'attachments';
    const uploaded = await this.minioService.uploadFile(file, folder);

    const proxyUrl = `/files/view?key=${encodeURIComponent(uploaded.key)}`;

    return {
      ...uploaded,
      proxy_url: proxyUrl,
    };
  }

  @Post('upload-multiple')
  @UseInterceptors(FilesInterceptor('files', 15, uploadMulterOptions))
  async uploadMultiple(@UploadedFiles() files: Express.Multer.File[], @Req() req: Request) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Fayllar yuborilmadi');
    }
    const folder = (req.query.folder as string) || 'attachments';
    const uploadedList = await this.minioService.uploadMultipleFiles(files, folder);

    return uploadedList.map((item) => ({
      ...item,
      proxy_url: `/files/view?key=${encodeURIComponent(item.key)}`,
    }));
  }

  @Get('view')
  async viewFile(@Query('key') key: string, @Res() res: Response) {
    if (!key || key.includes('..')) {
      throw new BadRequestException('Fayl kaliti (key) noto‘g‘ri');
    }
    try {
      const stat = await this.minioService.getStat(key);
      const stream = await this.minioService.getFileStream(key);

      const meta = stat.metaData as Record<string, unknown> | undefined;
      const rawContentType =
        typeof meta?.['content-type'] === 'string'
          ? meta['content-type'].split(';')[0].trim().toLowerCase()
          : '';

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600');

      if (SAFE_INLINE_CONTENT_TYPES.has(rawContentType)) {
        res.setHeader('Content-Type', rawContentType);
      } else {
        // XSS oldini olish uchun HTML/SVG va boshqa xavfli turlarni inline ochmaymiz
        const fallbackName = sanitizeDownloadFilename(key.split('/').pop() || 'file');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fallbackName)}`,
        );
      }

      res.setHeader('Content-Length', stat.size);
      stream.pipe(res);
    } catch {
      throw new NotFoundException('Fayl topilmadi');
    }
  }

  @Get('download')
  async downloadFile(@Query('key') key: string, @Res() res: Response) {
    if (!key || key.includes('..')) {
      throw new BadRequestException('Fayl kaliti (key) noto‘g‘ri');
    }
    try {
      const stat = await this.minioService.getStat(key);
      const stream = await this.minioService.getFileStream(key);

      const meta = stat.metaData as Record<string, unknown> | undefined;
      const rawName = meta ? meta['original-name'] : undefined;
      let decodedName = key.split('/').pop() || 'file';
      if (typeof rawName === 'string') {
        try {
          decodedName = decodeURIComponent(rawName);
        } catch {
          decodedName = rawName;
        }
      }

      const safeAsciiName = sanitizeDownloadFilename(decodedName).replace(/[^\x20-\x7E]/g, '_');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(decodedName)}`,
      );
      res.setHeader('Content-Length', stat.size);
      stream.pipe(res);
    } catch {
      throw new NotFoundException('Fayl topilmadi');
    }
  }
}
