import * as path from 'node:path';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { JwtAccessPayload } from '../../../common/types/jwt-payload.interface';
import { ApplicationsImportService } from './applications-import.service';
import { IMPORT_MAX_FILE_SIZE_BYTES } from './applications-import.types';
import { ApplicationsImportTemplateService } from './applications-import-template.service';

const EXCEL_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: IMPORT_MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.xlsx') {
      cb(
        new BadRequestException('Faqat .xlsx (Excel) formatidagi fayllarni yuklash mumkin'),
        false,
      );
      return;
    }
    cb(null, true);
  },
};

function assertValidXlsxBuffer(file?: Express.Multer.File): Buffer {
  if (!file || !file.buffer || file.buffer.length < 4) {
    throw new BadRequestException('Excel fayli yuklanmadi yoki fayl bo‘sh');
  }
  // XLSX — ZIP arxividir, birinchi 4 bayti PK\x03\x04 bo'lishi shart
  const isZipMagic =
    file.buffer[0] === 0x50 &&
    file.buffer[1] === 0x4b &&
    file.buffer[2] === 0x03 &&
    file.buffer[3] === 0x04;
  if (!isZipMagic) {
    throw new BadRequestException(
      'Fayl tarkibi haqiqiy .xlsx (Excel) formatiga mos kelmadi. Iltimos, faylni qayta saqlab yuklang.',
    );
  }
  return file.buffer;
}

@Controller('applications/import')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.STAFF,
  Role.INSPECTOR,
  Role.OPERATOR,
  Role.DISTRICT_OFFICER,
)
export class ApplicationsImportController {
  constructor(
    private readonly templateService: ApplicationsImportTemplateService,
    private readonly importService: ApplicationsImportService,
  ) {}

  @Get('template')
  async downloadTemplate(@Res() res: Response, @CurrentUser() currentUser?: JwtAccessPayload) {
    const workbook = await this.templateService.generateTemplateWorkbook(currentUser);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Arizalar_Import_Shabloni_${dateStr}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  @Post('preview')
  @UseInterceptors(FileInterceptor('file', EXCEL_UPLOAD_OPTIONS))
  async previewImport(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const buffer = assertValidXlsxBuffer(file);
    return this.importService.preview(buffer, currentUser);
  }

  @Post('commit')
  @UseInterceptors(FileInterceptor('file', EXCEL_UPLOAD_OPTIONS))
  async commitImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('skip_errors') skipErrorsRaw?: string | boolean,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const buffer = assertValidXlsxBuffer(file);
    const skipErrors =
      skipErrorsRaw === undefined
        ? true
        : skipErrorsRaw === true || String(skipErrorsRaw).toLowerCase() === 'true';

    return this.importService.commit(buffer, { skipErrors }, currentUser);
  }

  @Post('error-report')
  @UseInterceptors(FileInterceptor('file', EXCEL_UPLOAD_OPTIONS))
  async downloadErrorReport(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
    @CurrentUser() currentUser?: JwtAccessPayload,
  ) {
    const buffer = assertValidXlsxBuffer(file);
    const workbook = await this.importService.generateErrorReportFromFile(buffer, currentUser);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Xatoli_qatorlar_${dateStr}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  }
}
