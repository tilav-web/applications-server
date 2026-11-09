import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { DocumentsService } from './documents.service';
import { GenerateFromTemplateDto } from './dto/generate-from-template.dto';

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Tizimdagi mavjud rasmiy shablonlar ro'yxatini olish
   */
  @Get('documents/templates')
  @UseGuards(JwtAuthGuard)
  async getTemplates(@Query('script') script?: 'lotin' | 'krill') {
    return this.documentsService.getAvailableTemplates(script || 'lotin');
  }

  /**
   * Tanlangan shablon uchun ariza ma'lumotlarini avtomatik to'ldirilgan ko'rinishini (preview) olish
   */
  @Get('applications/:id/documents/template-preview/:templateId')
  @UseGuards(JwtAuthGuard)
  async getTemplatePreview(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Query('script') script: 'lotin' | 'krill' = 'lotin',
    @Req() req: any,
  ) {
    return this.documentsService.getTemplatePreview(id, templateId, script, req.user);
  }

  /**
   * Shablon asosida yangi Word hujjatini yaratish
   */
  @Post('applications/:id/documents/from-template')
  @UseGuards(JwtAuthGuard)
  async createFromTemplate(
    @Param('id') id: string,
    @Body() dto: GenerateFromTemplateDto,
    @Req() req: any,
  ) {
    return this.documentsService.createFromTemplate(id, dto, req.user);
  }

  /**
   * Ariza uchun bo'sh rasmiy hujjat yaratish
   */
  @Post('applications/:id/documents/blank')
  @UseGuards(JwtAuthGuard)
  async createBlankDocument(
    @Param('id') id: string,
    @Body('title') title: string,
    @Req() req: any,
  ) {
    return this.documentsService.createBlankDocument(id, req.user, title);
  }

  /**
   * Kompyuterdan mavjud Word (.docx / .doc) faylini arizaga yuklash
   */
  @Post('applications/:id/documents/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Word fayli tanlanmadi');
    }
    return this.documentsService.uploadDocument(id, file, req.user, title);
  }

  /**
   * Arizaning barcha Word hujjatlarini olish
   */
  @Get('applications/:id/documents')
  @UseGuards(JwtAuthGuard)
  async getDocumentsByApplication(@Param('id') id: string) {
    return this.documentsService.getDocumentsByApplication(id);
  }

  /**
   * Bitta hujjat haqida ma'lumot
   */
  @Get('documents/:id')
  @UseGuards(JwtAuthGuard)
  async getDocument(@Param('id') id: string) {
    return this.documentsService.getDocumentById(id);
  }

  /**
   * ONLYOFFICE uchun tahrirlash konfiguratsiyasini olish
   */
  @Get('documents/:id/config')
  @UseGuards(JwtAuthGuard)
  async getDocumentConfig(@Param('id') id: string, @Req() req: any) {
    return this.documentsService.getDocumentEditorConfig(id, req.user);
  }

  /**
   * Hujjat faylini yuklab olish yoki ko'rish (ONLYOFFICE uchun ochiq)
   */
  @Get('documents/:id/file')
  async downloadFile(@Param('id') id: string, @Res() res: Response) {
    const { stream, document } = await this.documentsService.getFileStream(id);

    const isDoc = document.file_type === 'doc';
    res.setHeader(
      'Content-Type',
      isDoc
        ? 'application/msword'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(document.file_name)}"`,
    );

    stream.pipe(res);
  }

  /**
   * ONLYOFFICE callback saqlash webhook'i (Status 200 OK qaytarishi shart!)
   */
  @Post('documents/:id/callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(@Param('id') id: string, @Body() body: any) {
    return this.documentsService.handleCallback(id, body);
  }

  /**
   * Hujjatni o'chirish
   */
  @Delete('documents/:id')
  @UseGuards(JwtAuthGuard)
  async deleteDocument(@Param('id') id: string) {
    return this.documentsService.deleteDocument(id);
  }
}

