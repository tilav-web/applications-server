import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../auth/auth.module';
import { MinioModule } from '../../minio/minio.module';
import { User } from '../../users/user.entity';
import { Application } from '../application.entity';
import { SuspectFieldConfig } from '../suspect-fields/suspect-field-config.entity';
import { Card } from '../transfers/cards/card.entity';
import { Transfer } from '../transfers/transfer.entity';
import { ApplicationDocument } from './application-document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentTemplate } from './templates/document-template.entity';
import { DocxEngineService } from './templates/docx-engine.service';
import { TemplatesController } from './templates/templates.controller';
import { TemplatesManagementService } from './templates/templates-management.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApplicationDocument,
      Application,
      User,
      DocumentTemplate,
      Transfer,
      Card,
      SuspectFieldConfig,
    ]),
    MinioModule,
    ConfigModule,
    AuthModule,
  ],
  controllers: [DocumentsController, TemplatesController],
  providers: [DocumentsService, TemplatesManagementService, DocxEngineService],
  exports: [DocumentsService, TemplatesManagementService, DocxEngineService],
})
export class DocumentsModule {}
