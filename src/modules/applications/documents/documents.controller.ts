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
import type {
  AuthenticatedRequest,
  JwtAccessPayload,
} from '../../../common/types/jwt-payload.interface';
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
    @Req() req: AuthenticatedRequest,
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
    @Req() req: AuthenticatedRequest,
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
    @Req() req: AuthenticatedRequest,
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
    @Req() req: AuthenticatedRequest,
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
  async getDocumentsByApplication(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documentsService.getDocumentsByApplication(id, req.user);
  }

  /**
   * Aniqlangan jinoyat uchun bo'sh rasmiy Word hujjat yaratish
   */
  @Post('detected-crimes/:id/documents/blank')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...WRITE_ROLES)
  async createBlankForDetectedCrime(
    @Param('id') id: string,
    @Body('title') title: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documentsService.createBlankForDetectedCrime(id, req.user, title);
  }

  /**
   * Aniqlangan jinoyatga Word (.docx / .doc) fayl yuklash
   */
  @Post('detected-crimes/:id/documents/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...WRITE_ROLES)
  @UseInterceptors(FileInterceptor('file', WORD_UPLOAD_OPTIONS))
  async uploadForDetectedCrime(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException('Word fayli tanlanmadi');
    }
    return this.documentsService.uploadForDetectedCrime(id, file, req.user, title);
  }

  /**
   * Aniqlangan jinoyatning barcha Word hujjatlarini olish
   */
  @Get('detected-crimes/:id/documents')
  @UseGuards(JwtAuthGuard)
  async getDocumentsByDetectedCrime(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documentsService.getDocumentsByDetectedCrime(id, req.user);
  }

  /**
   * Bitta hujjat haqida ma'lumot
   */
  @Get('documents/:id')
  @UseGuards(JwtAuthGuard)
  async getDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documentsService.getDocumentById(id, req.user);
  }

  /**
   * ONLYOFFICE uchun tahrirlash konfiguratsiyasini olish
   */
  @Get('documents/:id/config')
  @UseGuards(JwtAuthGuard)
  async getDocumentConfig(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documentsService.getDocumentEditorConfig(id, req.user);
  }

  /**
   * Hujjat faylini yuklab olish yoki ko'rish (faol sessiya yoki imzolangan ONLYOFFICE linki orqali)
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
    let actor: JwtAccessPayload | null = null;
    if (!isSignedOnlyOffice) {
      actor = await this.authService.verifyActiveAccessRequest(req);
      if (!actor) {
        throw new UnauthorizedException(
          'Hujjatni yuklab olish uchun faol tizim sessiyasi talab qilinadi',
        );
      }
    }

    const { stream, document } = await this.documentsService.getFileStream(id, actor);

    const isDoc = document.file_type === 'doc';
    const safeAsciiName =
      document.file_name
        .replace(/[\r\n"\\]/g, '_')
        .replace(/[^\x20-\x7E]/g, '_')
        .trim() || 'document.docx';

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
      `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(document.file_name)}`,
    );

    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).end();
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }

  /**
   * ONLYOFFICE callback saqlash webhook'i (JWT imzosi bilan himoyalangan)
   */
  @Post('documents/:id/callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.documentsService.handleCallback(id, body, req);
  }

  /**
   * Hujjatni o'chirish
   */
  @Delete('documents/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF)
  async deleteDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.documentsService.deleteDocument(id, req.user);
  }
}
