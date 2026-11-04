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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';

import { MinioService } from './minio.service';

@Controller('files')
export class MinioController {
  constructor(private readonly minioService: MinioService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('Fayl yuborilmadi');
    }
    const folder = (req.query.folder as string) || 'attachments';
    const uploaded = await this.minioService.uploadFile(file, folder);

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol;
    const proxyUrl = `${protocol}://${host}/files/view?key=${encodeURIComponent(uploaded.key)}`;

    return {
      ...uploaded,
      proxy_url: proxyUrl,
    };
  }

  @Post('upload-multiple')
  @UseInterceptors(FilesInterceptor('files', 15))
  async uploadMultiple(@UploadedFiles() files: Express.Multer.File[], @Req() req: Request) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Fayllar yuborilmadi');
    }
    const folder = (req.query.folder as string) || 'attachments';
    const uploadedList = await this.minioService.uploadMultipleFiles(files, folder);

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol;

    return uploadedList.map((item) => ({
      ...item,
      proxy_url: `${protocol}://${host}/files/view?key=${encodeURIComponent(item.key)}`,
    }));
  }

  @Get('view')
  async viewFile(@Query('key') key: string, @Res() res: Response) {
    if (!key) {
      throw new BadRequestException('Fayl kaliti (key) kiritilmagan');
    }
    try {
      const stat = await this.minioService.getStat(key);
      const stream = await this.minioService.getFileStream(key);

      const meta = stat.metaData as Record<string, unknown> | undefined;
      const contentType = meta?.['content-type'];
      if (typeof contentType === 'string') {
        res.setHeader('Content-Type', contentType);
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
      }

      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      stream.pipe(res);
    } catch {
      throw new NotFoundException('Fayl topilmadi');
    }
  }

  @Get('download')
  async downloadFile(@Query('key') key: string, @Res() res: Response) {
    if (!key) {
      throw new BadRequestException('Fayl kaliti (key) kiritilmagan');
    }
    try {
      const stat = await this.minioService.getStat(key);
      const stream = await this.minioService.getFileStream(key);

      const meta = stat.metaData as Record<string, unknown> | undefined;
      const rawName = meta ? meta['original-name'] : undefined;
      const originalName =
        typeof rawName === 'string' ? decodeURIComponent(rawName) : key.split('/').pop() || 'file';

      res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
      res.setHeader('Content-Length', stat.size);
      stream.pipe(res);
    } catch {
      throw new NotFoundException('Fayl topilmadi');
    }
  }
}
