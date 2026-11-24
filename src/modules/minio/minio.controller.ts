import {
  BadRequestException,
  Controller,
  ForbiddenException,
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

import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MinioService } from './minio.service';

const FILE_UPLOAD_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
];

const RESTRICTED_DIRECT_PREFIXES = ['documents/', 'templates/', 'audit-archives/'];

function assertValidMagicBytes(file: Express.Multer.File): void {
  const buf = file.buffer;
  if (!buf || buf.length < 4) return;
  const ext = extname(file.originalname || '').toLowerCase();
  const hex4 = buf.subarray(0, 4).toString('hex');
  const asciiStart = buf.subarray(0, 12).toString('ascii');

  if (ext === '.png' && hex4 !== '89504e47') {
    throw new BadRequestException('PNG fayl formati yaroqsiz');
  }
  if (
    (ext === '.jpg' || ext === '.jpeg') &&
    !(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
  ) {
    throw new BadRequestException('JPEG fayl formati yaroqsiz');
  }
  if (ext === '.gif' && !asciiStart.startsWith('GIF8')) {
    throw new BadRequestException('GIF fayl formati yaroqsiz');
  }
  if (ext === '.webp' && !(asciiStart.startsWith('RIFF') && asciiStart.slice(8, 12) === 'WEBP')) {
    throw new BadRequestException('WEBP fayl formati yaroqsiz');
  }
  if (ext === '.pdf' && !asciiStart.startsWith('%PDF')) {
    throw new BadRequestException('PDF fayl formati yaroqsiz');
  }
  if (
    (ext === '.docx' || ext === '.xlsx' || ext === '.zip') &&
    !(buf[0] === 0x50 && buf[1] === 0x4b)
  ) {
    throw new BadRequestException(`${ext} fayl tuzilmasi yaroqsiz`);
  }
  if ((ext === '.doc' || ext === '.xls') && hex4 !== 'd0cf11e0') {
    throw new BadRequestException(`${ext} fayl tuzilmasi yaroqsiz`);
  }
}

function assertSafeObjectKey(key: string): string {
  const normalized = (key || '').trim();
  if (
    !normalized ||
    normalized.includes('..') ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    normalized.includes('\\')
  ) {
    throw new BadRequestException('Fayl kaliti (key) noto‘g‘ri');
  }
  const lower = normalized.toLowerCase();
  if (RESTRICTED_DIRECT_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    throw new ForbiddenException(
      'Rasmiy hujjatlar va shablonlarni faqat maxsus himoyalangan endpoint orqali olish mumkin',
    );
  }
  return normalized;
}

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
@UseGuards(JwtAuthGuard, RolesGuard)
export class MinioController {
  constructor(private readonly minioService: MinioService) {}

  @Post('upload')
  @Roles(...FILE_UPLOAD_ROLES)
  @UseInterceptors(FileInterceptor('file', uploadMulterOptions))
  async uploadSingle(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('Fayl yuborilmadi');
    }
    assertValidMagicBytes(file);
    const folder = (req.query.folder as string) || 'attachments';
    const uploaded = await this.minioService.uploadFile(file, folder);

    const proxyUrl = `/files/view?key=${encodeURIComponent(uploaded.key)}`;

    return {
      ...uploaded,
      proxy_url: proxyUrl,
    };
  }

  @Post('upload-multiple')
  @Roles(...FILE_UPLOAD_ROLES)
  @UseInterceptors(FilesInterceptor('files', 15, uploadMulterOptions))
  async uploadMultiple(@UploadedFiles() files: Express.Multer.File[], @Req() req: Request) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Fayllar yuborilmadi');
    }
    for (const f of files) {
      assertValidMagicBytes(f);
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
    const safeKey = assertSafeObjectKey(key);
    try {
      const stat = await this.minioService.getStat(safeKey);
      const stream = await this.minioService.getFileStream(safeKey);

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
        const fallbackName = sanitizeDownloadFilename(safeKey.split('/').pop() || 'file');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fallbackName)}`,
        );
      }

      res.setHeader('Content-Length', stat.size);
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
        else res.end();
      });
      stream.pipe(res);
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof BadRequestException) throw err;
      throw new NotFoundException('Fayl topilmadi');
    }
  }

  @Get('download')
  async downloadFile(@Query('key') key: string, @Res() res: Response) {
    const safeKey = assertSafeObjectKey(key);
    try {
      const stat = await this.minioService.getStat(safeKey);
      const stream = await this.minioService.getFileStream(safeKey);

      const meta = stat.metaData as Record<string, unknown> | undefined;
      const rawName = meta ? meta['original-name'] : undefined;
      let decodedName = safeKey.split('/').pop() || 'file';
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
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
        else res.end();
      });
      stream.pipe(res);
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof BadRequestException) throw err;
      throw new NotFoundException('Fayl topilmadi');
    }
  }
}
