import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Document, Packer, Paragraph } from 'docx';
import * as fs from 'fs';
import * as path from 'path';
import PizZip from 'pizzip';
import { Repository } from 'typeorm';

import { MinioService } from '../../../minio/minio.service';
import { Application } from '../../application.entity';
import { SuspectFieldConfig } from '../../suspect-fields/suspect-field-config.entity';
import { Transfer } from '../../transfers/transfer.entity';
import { DocumentTemplate } from './document-template.entity';
import { DocxEngineService } from './docx-engine.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { buildTemplateContext } from './template-data.builder';
import {
  TEMPLATE_VARIABLES_DICTIONARY,
  TemplateCategoryConfig,
  TemplateVariableItem,
} from './template-variables.dictionary';

@Injectable()
export class TemplatesManagementService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TemplatesManagementService.name);

  async onApplicationBootstrap() {
    await this.seedDefaultTemplatesIfEmpty();
  }

  constructor(
    @InjectRepository(DocumentTemplate)
    private readonly templateRepo: Repository<DocumentTemplate>,
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @InjectRepository(SuspectFieldConfig)
    private readonly suspectFieldConfigRepo: Repository<SuspectFieldConfig>,
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
    private readonly docxEngine: DocxEngineService,
  ) {}

  /**
   * Barcha shablonlar ro'yxatini olish
   */
  async getAllTemplates(
    script: 'lotin' | 'krill' = 'lotin',
    category?: string,
    search?: string,
  ): Promise<DocumentTemplate[]> {
    const qb = this.templateRepo.createQueryBuilder('t');

    if (category && category !== 'all') {
      qb.andWhere('t.category = :category', { category });
    }

    if (search && search.trim()) {
      qb.andWhere(
        '(LOWER(t.title) LIKE :search OR LOWER(t.description) LIKE :search OR LOWER(t.category) LIKE :search)',
        { search: `%${search.toLowerCase().trim()}%` },
      );
    }

    qb.orderBy('t.created_at', 'ASC');
    const templates = await qb.getMany();

    // Agar Krill so'ralsa va title_krill mavjud bo'lsa, uni sarlavha sifatida ko'rsatish
    return templates.map((tpl) => {
      (tpl as any).displayTitle =
        script === 'krill' && tpl.title_krill ? tpl.title_krill : tpl.title;
      return tpl;
    });
  }

  /**
   * Bitta shablonni olish
   */
  async getTemplateById(id: string): Promise<DocumentTemplate> {
    const tpl = await this.templateRepo.findOne({ where: { id } });
    if (!tpl) {
      throw new NotFoundException(`Shablon (ID: ${id}) topilmadi`);
    }
    return tpl;
  }

  /**
   * O'zgaruvchilar lug'atini olish (Frontend Drawer uchun)
   */
  async getVariablesDictionary(): Promise<TemplateCategoryConfig[]> {
    let customSuspectItems: TemplateVariableItem[] = [];
    try {
      const activeConfigs = await this.suspectFieldConfigRepo.find({
        where: { is_active: true },
        order: { sort_order: 'ASC', created_at: 'ASC' },
      });

      if (activeConfigs.length > 0) {
        customSuspectItems = [
          {
            tag: '{{suspect.details}}',
            rawKey: 'suspect.details',
            label: 'To‘liq ro‘yxat matni (details)',
            modelName: 'Suspect',
            description:
              'Barcha kiritilgan parametrlar matni (masalan: Telegram Username: @tilav_web; Telefon: +998...)',
            sampleValue: 'Telegram Username: @tilav_web; Telegram ID: 12345678',
          },
          {
            tag: '{{#suspect_list}} • {{label}}: {{value}} {{#note}}({{note}}){{/note}}\n{{/suspect_list}}',
            rawKey: 'suspect_list',
            label: 'Parametrlar ro‘yxati sikli (suspect_list)',
            modelName: 'Suspect',
            description: 'Har bir parametrni alohida qatorda chiqarish uchun docx sikli (loop)',
            sampleValue: '• Telegram Username: @tilav_web (Asosiy aloqa)\n• Telegram ID: 12345678',
          },
        ];

        for (const cfg of activeConfigs) {
          customSuspectItems.push({
            tag: `{{suspect.${cfg.key}}}`,
            rawKey: `suspect.${cfg.key}`,
            label: `${cfg.label} (${cfg.key})`,
            modelName: 'Suspect',
            description: cfg.description || `${cfg.label} qiymati`,
            sampleValue: cfg.sample_value || '@username',
          });
          customSuspectItems.push({
            tag: `{{suspect.${cfg.key}_note}}`,
            rawKey: `suspect.${cfg.key}_note`,
            label: `${cfg.label} izohi (${cfg.key}_note)`,
            modelName: 'Suspect',
            description: `${cfg.label} uchun kiritilgan izoh`,
            sampleValue: 'Asosiy kanal',
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `getVariablesDictionary suspect_field_configs olishda xatolik: ${e.message}`,
      );
    }

    if (customSuspectItems.length > 0) {
      return TEMPLATE_VARIABLES_DICTIONARY.map((cat) => {
        if (cat.id === 'suspect') {
          return {
            ...cat,
            items: customSuspectItems,
          };
        }
        return cat;
      });
    }

    return TEMPLATE_VARIABLES_DICTIONARY;
  }

  /**
   * Noldan bo'sh Word shablonini yaratish
   */
  async createBlankTemplate(dto: CreateTemplateDto, user: any): Promise<DocumentTemplate> {
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                bottom: 1440,
                left: 1440,
                right: 1440,
              },
            },
          },
          children: [
            new Paragraph({
              children: [],
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const cleanFileName = `shablon_${Date.now()}.docx`;
    const folder = 'templates';
    const fileKey = `${folder}/${cleanFileName}`;

    const uploaded = await this.minioService.uploadBuffer(
      buffer,
      fileKey,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      cleanFileName,
    );

    const docKey = `tpl_${randomUUID().slice(0, 8)}_${Date.now()}`;

    const newTemplate = this.templateRepo.create({
      title: dto.title.trim(),
      title_krill: dto.title_krill?.trim() || null,
      description: dto.description?.trim() || null,
      category: dto.category?.trim() || null,
      file_key: uploaded.key,
      file_name: cleanFileName,
      file_size: buffer.length,
      version: 1,
      doc_key: docKey,
      is_active: true,
      available_tags: [],
      created_by_id: user?.sub || user?.id || null,
    });

    return this.templateRepo.save(newTemplate);
  }

  /**
   * Kompyuterdan .docx shablon faylini yuklash
   */
  async uploadTemplateFile(
    file: Express.Multer.File,
    dto: CreateTemplateDto,
    user: any,
  ): Promise<DocumentTemplate> {
    if (!file) {
      throw new BadRequestException('Fayl tanlanmadi');
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext !== 'docx') {
      throw new BadRequestException('Faqat .docx formatidagi fayllar qabul qilinadi');
    }

    // Shablonni xatoliklarga tekshirish va teglarni ajratib olish
    const validation = this.docxEngine.validateTemplate(file.buffer);
    if (!validation.valid) {
      this.logger.warn(`Yuklangan shablonda ogohlantirishlar: ${validation.errors.join('; ')}`);
    }

    const cleanFileName = `tpl_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const fileKey = `templates/${cleanFileName}`;

    const uploaded = await this.minioService.uploadBuffer(
      file.buffer,
      fileKey,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      cleanFileName,
    );

    const docKey = `tpl_${randomUUID().slice(0, 8)}_${Date.now()}`;

    const newTemplate = this.templateRepo.create({
      title: dto.title?.trim() || file.originalname.replace(/\.docx$/i, ''),
      title_krill: dto.title_krill?.trim() || null,
      description: dto.description?.trim() || null,
      category: dto.category?.trim() || null,
      file_key: uploaded.key,
      file_name: cleanFileName,
      file_size: file.size,
      version: 1,
      doc_key: docKey,
      is_active: true,
      available_tags: validation.tags,
      created_by_id: user?.sub || user?.id || null,
    });

    return this.templateRepo.save(newTemplate);
  }

  /**
   * Shablon ma'lumotlarini yangilash
   */
  async updateTemplate(id: string, dto: UpdateTemplateDto): Promise<DocumentTemplate> {
    const tpl = await this.getTemplateById(id);

    if (dto.title !== undefined) tpl.title = dto.title.trim();
    if (dto.title_krill !== undefined) tpl.title_krill = dto.title_krill.trim();
    if (dto.description !== undefined) tpl.description = dto.description?.trim() || null;
    if (dto.category !== undefined) tpl.category = dto.category.trim();
    if (dto.is_active !== undefined) tpl.is_active = dto.is_active;

    return this.templateRepo.save(tpl);
  }

  /**
   * Shablonni o'chirish
   */
  async deleteTemplate(id: string): Promise<boolean> {
    const tpl = await this.getTemplateById(id);
    try {
      await this.minioService.deleteFile(tpl.file_key);
      if (tpl.file_key_krill) {
        await this.minioService.deleteFile(tpl.file_key_krill);
      }
    } catch (e) {
      this.logger.warn(`MinIO faylini o'chirishda ogohlantirish: ${e}`);
    }

    await this.templateRepo.remove(tpl);
    return true;
  }

  /**
   * ONLYOFFICE uchun shablonni tahrirlash konfiguratsiyasi
   */
  async getTemplateEditorConfig(id: string, user: any) {
    const tpl = await this.getTemplateById(id);

    const internalServerHost =
      this.configService.get<string>('ONLYOFFICE_SERVER_INTERNAL_HOST') || 'uvd_app_server:3000';

    const fileUrl = `http://${internalServerHost}/templates/${tpl.id}/file`;
    const callbackUrl = `http://${internalServerHost}/templates/${tpl.id}/callback`;

    const userName = user
      ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Admin'
      : 'Admin';

    const docKey = tpl.doc_key || `tpl_${tpl.id}_${new Date(tpl.updated_at).getTime()}`;

    return {
      documentType: 'word',
      document: {
        fileType: 'docx',
        key: docKey,
        title: `${tpl.title}.docx`,
        url: fileUrl,
        permissions: {
          comment: true,
          copy: true,
          download: true,
          edit: true,
          fillForms: true,
          modifyContentControl: true,
          modifyFilter: true,
          print: true,
          review: true,
        },
      },
      editorConfig: {
        mode: 'edit',
        lang: 'uz-UZ',
        user: {
          id: String(user?.id || 'admin'),
          name: userName,
        },
        callbackUrl,
        customization: {
          autosave: true,
          chat: false,
          comments: true,
          compactHeader: false,
          toolbarNoTabs: false,
          zoom: 100,
        },
      },
      templateId: tpl.id,
      title: tpl.title,
    };
  }

  /**
   * Shablon fayli oqimi (OnlyOffice yoki yuklab olish uchun)
   */
  async getTemplateFileStream(id: string) {
    const tpl = await this.getTemplateById(id);
    const stream = await this.minioService.getFileStream(tpl.file_key);
    return {
      stream,
      template: tpl,
    };
  }

  /**
   * ONLYOFFICE dan shablon saqlanganda keladigan callback handler
   */
  async handleTemplateCallback(id: string, body: any): Promise<{ error: number }> {
    this.logger.log(
      `ONLYOFFICE template callback keldi (Template ID: ${id}, Status: ${body?.status})`,
    );

    // 2 = Document is ready for saving, 6 = Force-saved
    if (body?.status === 2 || body?.status === 6) {
      const downloadUrl: string = body.url;
      if (!downloadUrl) {
        return { error: 0 };
      }

      try {
        let targetUrl = downloadUrl;
        try {
          const parsed = new URL(downloadUrl);
          targetUrl = `http://uvd_app_onlyoffice${parsed.pathname}${parsed.search}`;
        } catch (e) {
          this.logger.warn(`URL parse qilishda ogohlantirish: ${e}`);
        }

        let response = await fetch(targetUrl);
        if (!response.ok && targetUrl !== downloadUrl) {
          response = await fetch(downloadUrl);
        }

        if (!response.ok) {
          throw new Error(`Shablon faylini yuklab olishda xatolik: HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const tpl = await this.getTemplateById(id);

        // MinIO ga yozish
        await this.minioService.uploadBuffer(
          buffer,
          tpl.file_key,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          tpl.file_name,
        );

        // Yangi teglarni qayta hisoblash
        const tags = this.docxEngine.extractTags(buffer);

        tpl.version += 1;
        tpl.file_size = buffer.length;
        tpl.available_tags = tags;
        tpl.doc_key = `tpl_${randomUUID().slice(0, 8)}_${Date.now()}`;
        await this.templateRepo.save(tpl);

        this.logger.log(
          `Shablon (ID: ${id}) saqlandi (v${tpl.version}, teglar soni: ${tags.length})`,
        );
      } catch (err) {
        this.logger.error(`ONLYOFFICE shablonini saqlashda xatolik:`, err);
        return { error: 1 };
      }
    }

    return { error: 0 };
  }

  /**
   * Shablonni sinab ko'rish (Test generatsiya)
   */
  async testGenerateTemplate(
    templateId: string,
    applicationId?: string,
    script: 'lotin' | 'krill' = 'lotin',
    user?: any,
  ): Promise<Buffer> {
    const tpl = await this.getTemplateById(templateId);

    // MinIO dan shablon buferini yuklab olamiz
    const stream = await this.minioService.getFileStream(tpl.file_key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const templateBuffer = Buffer.concat(chunks);

    let application: Application | null = null;
    let transfers: Transfer[] = [];

    if (applicationId) {
      application = await this.applicationRepo.findOne({
        where: { id: applicationId },
        relations: {
          citizen: {
            district: true,
            mahalla: true,
          },
          crime: true,
          district: true,
          card: {
            bank: true,
          },
          transfer: {
            sender_card: true,
            receiver_card: {
              bank: true,
            },
            payment_provider: true,
          },
          application_status: true,
          custom_fields: {
            citizen: { district: true, mahalla: true },
            card: { bank: true },
            crime: true,
            district: true,
            transfer: { payment_provider: true },
          },
        },
      });

      transfers = await this.transferRepo.find({
        where: { application_id: applicationId },
        relations: {
          sender_card: true,
          receiver_card: {
            bank: true,
          },
          payment_provider: true,
        },
      });
    }

    // Agar berilgan ariza topilmasa yoki ko'rsatilmagan bo'lsa, namunaviy mockup ma'lumotlar tuzamiz
    if (!application) {
      application = {
        application_number: '2026-TEST-001',
        description:
          'Namunaviy sinov arizasi matni. Telegram messenjeri orqali firibgarlik holati.',
        date: new Date(),
        citizen: {
          first_name: 'Sanjar',
          last_name: 'Ergashev',
          middle_name: 'To‘g‘aymurodovich',
          passport: 'AA 1234567',
          pinfl: '30906781230012',
          phone_number: '+998901234567',
          birth_date: '1985-06-15',
          gender: 'male',
          address: 'Qarshi shahri, Mustaqillik ko‘chasi, 12-uy',
          district: { name: 'Qarshi shahri' },
          mahalla: { name: 'Mustaqillik MFY' },
        } as any,
        crime: {
          article: '168-modda',
          part: '3-qismi',
          title: 'Firibgarlik',
          category: 'Mulkka qarshi jinoyatlar',
          description:
            'O‘zganing mulkini aldash yoki ishonchni suiiste’mol qilish yo‘li bilan talon-toroj qilish',
        } as any,
        application_status: {
          name: 'Jarayonda',
          code: 'PROCESSING',
          description: 'Ariza bo‘yicha tergov harakatlari olib borilmoqda',
        } as any,
        custom_fields: [
          {
            key: 'dalil_tavsifi',
            label: 'Dalillar tavsifi',
            value: 'Fuqaroning telefoni ko‘zdan kechirildi va skrinshotlar ilova qilindi',
          },
        ] as any,
        district: { name: 'Qarshi tumani' } as any,
        card: {
          card_number: '8600123456789012',
          full_name: 'SANJAR ERGASHEV',
          bank: { name: 'O‘zmilliybank' },
        } as any,
        transfer: {
          amount: 5000000,
          receiver_card: {
            card_number: '9860998877665544',
            full_name: 'ALIEV VALI',
            bank: { name: 'Anorbank' },
          },
        } as any,
      } as Application;

      transfers = [
        {
          amount: 2500000,
          sender_card: { card_number: '8600123456789012' } as any,
          receiver_card: { card_number: '9860998877665544' } as any,
          transfer_date: '01.07.2026',
          transfer_time: '14:35',
          payment_provider: { name: 'Payme' } as any,
          status: 'BAJARILDI' as any,
        } as any,
        {
          amount: 2500000,
          sender_card: { card_number: '8600123456789012' } as any,
          receiver_card: { card_number: '9860998877665544' } as any,
          transfer_date: '01.07.2026',
          transfer_time: '14:37',
          payment_provider: { name: 'Payme' } as any,
          status: 'BAJARILDI' as any,
        } as any,
      ];
    }

    const context = buildTemplateContext(application, transfers, user, script, {});

    return this.docxEngine.renderTemplate(templateBuffer, context);
  }

  /**
   * Dastlabki 5 ta rasmiy shablonni bazaga avtomatik kiritish (Seeder)
   */
  async seedDefaultTemplatesIfEmpty(): Promise<void> {
    try {
      const count = await this.templateRepo.count();
      if (count > 0) {
        return;
      }

      this.logger.log(
        'Shablonlar jadvali bo‘sh. Boshlang‘ich rasmiy shablonlar bazaga kiritilmoqda...',
      );

      const possibleDirs = [
        path.resolve(process.cwd(), 'templates'),
        path.resolve(process.cwd(), 'docx_templates'),
        path.resolve(process.cwd(), '../docx_templates'),
        path.resolve(process.cwd(), '../templates'),
        path.resolve(__dirname, '../../../../../../docx_templates'),
        path.resolve(__dirname, '../../../../../../templates'),
      ];

      let baseTemplatesDir = '';
      for (const d of possibleDirs) {
        if (fs.existsSync(d)) {
          baseTemplatesDir = d;
          break;
        }
      }

      if (!baseTemplatesDir) {
        this.logger.warn('docx_templates papkasi topilmadi, seeder o‘tkazib yuborildi');
        return;
      }

      const defaultSeeds = [
        {
          title: 'Tushuntirish xati (Telegram orqali firibgarlik)',
          title_krill: 'Тушунтириш хати (Телеграм орқали фирибгарлик)',
          category: 'Tushuntirish xati',
          description:
            'Fuqaroning Telegram akkaunti buzilishi yoki uning nomidan tanishlaridan pul so‘rash holati bo‘yicha 2 betlik tushuntirish xati',
          lotinFileName: '1. TUSHUNTIRISH XATI NAMUNA LOTINDA.docx',
          krillFileName: '1. TUSHUNTIRISH XATI NAMUNA KRILLDA.docx',
        },
        {
          title: 'Tushuntirish xati (Zararli APK ilova)',
          title_krill: 'Тушунтириш хати (Зарарли АПК илова)',
          category: 'Tushuntirish xati',
          description:
            'Soxta reklama yoki zararli APK ilova o‘rnatilgach bank kartasidan pul mablag‘lari yechilishi holati bo‘yicha 2 betlik tushuntirish xati',
          lotinFileName: '2. TUSHUNTIRISH XATI NAMUNA LOTINDA.docx',
          krillFileName: '2. TUSHUNTIRISH XATI NAMUNA KRILLDA.docx',
        },
        {
          title: 'Murojaat bayonnomasi (1-betlik)',
          title_krill: 'Мурожаат баённомаси (1-бетлик)',
          category: 'Bayonnoma',
          description: 'Fuqaroning ariza yoki murojaati yuzasidan 1 betlik rasmiy bayonnoma',
          lotinFileName: '4. BAYONNOMA 1 BET LOTINDA.docx',
          krillFileName: '4. BAYONNOMA 1 BET.docx',
        },
        {
          title: 'Sanksiya iltimosnomasi (O‘g‘rilik)',
          title_krill: 'Санкция илтимосномаси (Ўғрилик)',
          category: 'Sanksiya',
          description:
            'Bank kartasidan o‘g‘irlangan mablag‘lar yuzasidan prokurorga sanksiya berish haqida iltimosnoma',
          lotinFileName: 'Sanksiya O‘G‘RILIK NAMUNA LOTINDA.docx',
          krillFileName: 'Санкция ЎҒРИЛИК НАМУНА.docx',
        },
        {
          title: 'Sanksiya iltimosnomasi (Firibgarlik)',
          title_krill: 'Санкция илтимосномаси (Фирибгарлик)',
          category: 'Sanksiya',
          description: 'Firibgarlik holati bo‘yicha prokurorga sanksiya berish haqida iltimosnoma',
          lotinFileName: 'Sanksiya firibgarlik NAMUNA LOTINDA.docx',
          krillFileName: 'Санкция фирибгарлик НАМУНА.docx',
        },
      ];

      for (const item of defaultSeeds) {
        const lotinPath = path.join(baseTemplatesDir, 'lotin', item.lotinFileName);
        const krillPath = path.join(baseTemplatesDir, 'krill', item.krillFileName);

        if (!fs.existsSync(lotinPath)) {
          this.logger.warn(`Lotin fayli topilmadi: ${lotinPath}`);
          continue;
        }

        const lotinRawBuffer = fs.readFileSync(lotinPath);
        // Shablon ichidagi namuna ismlarni teglarga aylantirish
        const zip = new PizZip(lotinRawBuffer);
        let xml = zip.file('word/document.xml')?.asText() || '';

        xml = xml.split('Ergashev Sanjar Togaymurodovich').join('{{citizen.full_name}}');
        xml = xml.split('S.Ergashev').join('{{citizen.short_name}}');
        xml = xml.split('A.S.Ismoilovga').join('{{head.title}}');
        xml = xml.split('+99897 222 25 25').join('{{citizen.phone}}');

        zip.file('word/document.xml', xml);
        const transformedLotinBuffer = zip.generate({ type: 'nodebuffer' });

        const lotinKey = `templates/seed_${Date.now()}_${item.lotinFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await this.minioService.uploadBuffer(
          transformedLotinBuffer,
          lotinKey,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          item.lotinFileName,
        );

        let krillKey: string | null = null;
        if (fs.existsSync(krillPath)) {
          const krillRawBuffer = fs.readFileSync(krillPath);
          const krillZip = new PizZip(krillRawBuffer);
          let kXml = krillZip.file('word/document.xml')?.asText() || '';
          kXml = kXml.split('Эргашев Санжар Тогаймуродович').join('{{citizen.full_name}}');
          kXml = kXml.split('С.Эргашев').join('{{citizen.short_name}}');
          kXml = kXml.split('А.С.Исмоиловга').join('{{head.title}}');
          kXml = kXml.split('+99897 222 25 25').join('{{citizen.phone}}');

          krillZip.file('word/document.xml', kXml);
          const transformedKrillBuffer = krillZip.generate({ type: 'nodebuffer' });

          krillKey = `templates/seed_${Date.now()}_${item.krillFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          await this.minioService.uploadBuffer(
            transformedKrillBuffer,
            krillKey,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            item.krillFileName,
          );
        }

        const tags = this.docxEngine.extractTags(transformedLotinBuffer);
        const docKey = `tpl_${randomUUID().slice(0, 8)}_${Date.now()}`;

        const tpl = this.templateRepo.create({
          title: item.title,
          title_krill: item.title_krill,
          description: item.description,
          category: item.category,
          file_key: lotinKey,
          file_key_krill: krillKey,
          file_name: item.lotinFileName,
          file_size: transformedLotinBuffer.length,
          version: 1,
          doc_key: docKey,
          is_active: true,
          available_tags: tags,
        });

        await this.templateRepo.save(tpl);
        this.logger.log(`Shablon bazaga kiritildi: ${tpl.title}`);
      }

      this.logger.log('Boshlang‘ich shablonlar muvaffaqiyatli yuklandi!');
    } catch (e: any) {
      this.logger.error(`Shablonlarni seeder qilishda xatolik:`, e);
    }
  }
}
