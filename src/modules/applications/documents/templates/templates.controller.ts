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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { TemplatesManagementService } from './templates-management.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesManagementService) {}

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
  @UseGuards(JwtAuthGuard)
  async createBlankTemplate(@Body() dto: CreateTemplateDto, @Req() req: any) {
    return this.templatesService.createBlankTemplate(dto, req.user);
  }

  /**
   * Kompyuterdan .docx shablon faylini yuklash
   */
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
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
  @UseGuards(JwtAuthGuard)
  async updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templatesService.updateTemplate(id, dto);
  }

  /**
   * Shablonni o'chirish
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
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
   * Shablon faylini yuklab olish yoki ko'rish (ONLYOFFICE uchun ochiq)
   */
  @Get(':id/file')
  async downloadTemplateFile(@Param('id') id: string, @Res() res: Response) {
    const { stream, template } = await this.templatesService.getTemplateFileStream(id);

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
   * ONLYOFFICE shablon saqlash callback webhook'i (Status 200 OK qaytarishi shart)
   */
  @Post(':id/callback')
  @HttpCode(HttpStatus.OK)
  async handleCallback(@Param('id') id: string, @Body() body: any) {
    return this.templatesService.handleTemplateCallback(id, body);
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
