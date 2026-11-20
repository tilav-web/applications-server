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
  Put,
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

import { Roles } from '../../../../common/decorators/roles.decorator';
import { Role } from '../../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { AuthService } from '../../../auth/auth.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { TemplatesManagementService } from './templates-management.service';

const TEMPLATE_UPLOAD_OPTIONS = {
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const ext = extname(file.originalname || '').toLowerCase();
    if (ext !== '.docx') {
      cb(new BadRequestException('Faqat .docx shablon fayllarini yuklash mumkin'), false);
      return;
    }
    cb(null, true);
  },
};

const TEMPLATE_WRITE_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.STAFF, Role.INSPECTOR];

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesManagementService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Barcha shablonlar ro'yxatini olish
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getTemplates(
    @Query('script') script?: 'lotin' | 'krill',
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.templatesService.getAllTemplates(script || 'lotin', category, search);
  }

  /**
   * O'zgaruvchilar katalogi (Data Dictionary - Frontend Drawer uchun)
   */
  @Get('variables')
  @UseGuards(JwtAuthGuard)
  getVariablesDictionary() {
    return this.templatesService.getVariablesDictionary();
  }

  /**
   * Bitta shablon haqida to'liq ma'lumot
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getTemplate(@Param('id') id: string) {
    return this.templatesService.getTemplateById(id);
  }

  /**
   * Bo'sh Word shablonini yaratish
   */
  @Post('blank')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...TEMPLATE_WRITE_ROLES)
  async createBlankTemplate(@Body() dto: CreateTemplateDto, @Req() req: any) {
    return this.templatesService.createBlankTemplate(dto, req.user);
  }

  /**
   * Kompyuterdan .docx shablon faylini yuklash
   */
  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...TEMPLATE_WRITE_ROLES)
  @UseInterceptors(FileInterceptor('file', TEMPLATE_UPLOAD_OPTIONS))
  async uploadTemplate(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateTemplateDto,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Word (.docx) fayli tanlanmadi');
    }
    return this.templatesService.uploadTemplateFile(file, dto, req.user);
  }

  /**
   * Shablon ma'lumotlarini tahrirlash
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...TEMPLATE_WRITE_ROLES)
  async updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templatesService.updateTemplate(id, dto);
  }

  /**
   * Shablonni o'chirish
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async deleteTemplate(@Param('id') id: string) {
    return this.templatesService.deleteTemplate(id);
  }

  /**
   * ONLYOFFICE uchun tahrirlash konfiguratsiyasini olish
   */
  @Get(':id/config')
  @UseGuards(JwtAuthGuard)
  async getTemplateEditorConfig(@Param('id') id: string, @Req() req: any) {
    return this.templatesService.getTemplateEditorConfig(id, req.user);
  }

  /**
   * Shablon faylini yuklab olish yoki ko'rish (foydalanuvchi sessiyasi yoki imzolangan ONLYOFFICE linki orqali)
   */
  @Get(':id/file')
  async downloadTemplateFile(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const isSignedOnlyOffice = this.templatesService.verifySignedTemplateFileAccess(id, exp, sig);
    if (!isSignedOnlyOffice) {
      const authId = await this.authService.resolveAuthIdFromRequest(req);
      if (!authId) {
        throw new UnauthorizedException(
          'Shablonni yuklab olish uchun tizimga kirish talab qilinadi',
        );
      }
    }

    const { stream, template } = await this.templatesService.getTemplateFileStream(id);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(template.file_name)}"`,
    );

    stream.pipe(res);
  }

  /**
   * ONLYOFFICE shablon saqlash callback webhook'i (JWT imzosi bilan himoyalangan)
   */
  @Post(':id/callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return this.templatesService.handleTemplateCallback(id, body, req);
  }

  /**
   * Shablonni sinab ko'rish (Test generatsiya)
   */
  @Post(':id/test-generate')
  @UseGuards(JwtAuthGuard)
  async testGenerate(
    @Param('id') id: string,
    @Body('applicationId') applicationId?: string,
    @Body('script') script: 'lotin' | 'krill' = 'lotin',
    @Req() req?: any,
    @Res() res?: Response,
  ) {
    const buffer = await this.templatesService.testGenerateTemplate(
      id,
      applicationId,
      script,
      req?.user,
    );

    if (res) {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader('Content-Disposition', `attachment; filename="test_output_${Date.now()}.docx"`);
      res.send(buffer);
    } else {
      return buffer;
    }
  }
}
