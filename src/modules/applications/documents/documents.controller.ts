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
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { extname } from 'path';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthService } from '../../auth/auth.service';
import { DocumentsService } from './documents.service';
import { GenerateFromTemplateDto } from './dto/generate-from-template.dto';

const WORD_UPLOAD_OPTIONS = {
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const ext = extname(file.originalname || '').toLowerCase();
    if (ext !== '.docx' && ext !== '.doc') {
      cb(new BadRequestException('Faqat .docx yoki .doc fayllarini yuklash mumkin'), false);
      return;
    }
    cb(null, true);
  },
};

const WRITE_ROLES = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.STAFF,
  Role.DISTRICT_OFFICER,
  Role.INSPECTOR,
  Role.OPERATOR,
];

@Controller()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly authService: AuthService,
  ) {}

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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...WRITE_ROLES)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...WRITE_ROLES)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...WRITE_ROLES)
  @UseInterceptors(FileInterceptor('file', WORD_UPLOAD_OPTIONS))
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
   * Hujjat faylini yuklab olish yoki ko'rish (foydalanuvchi sessiyasi yoki imzolangan ONLYOFFICE linki orqali)
   */
  @Get('documents/:id/file')
  async downloadFile(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const isSignedOnlyOffice = this.documentsService.verifySignedFileAccess(id, exp, sig);
    if (!isSignedOnlyOffice) {
      const authId = await this.authService.resolveAuthIdFromRequest(req);
      if (!authId) {
        throw new UnauthorizedException(
          'Hujjatni yuklab olish uchun tizimga kirish talab qilinadi',
        );
      }
    }

    const { stream, document } = await this.documentsService.getFileStream(id);

    const isDoc = document.file_type === 'doc';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
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
   * ONLYOFFICE callback saqlash webhook'i (JWT imzosi bilan himoyalangan)
   */
  @Post('documents/:id/callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.documentsService.handleCallback(id, body, req);
  }

  /**
   * Hujjatni o'chirish
   */
  @Delete('documents/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async deleteDocument(@Param('id') id: string) {
    return this.documentsService.deleteDocument(id);
  }
}
