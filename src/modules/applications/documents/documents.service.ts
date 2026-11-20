import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Document, Packer, Paragraph } from 'docx';
import * as fs from 'fs';
import JSZip from 'jszip';
import * as path from 'path';
import { Repository } from 'typeorm';

import { MinioService } from '../../minio/minio.service';
import { User } from '../../users/user.entity';
import { Application } from '../application.entity';
import { Transfer } from '../transfers/transfer.entity';
import { ApplicationDocument } from './application-document.entity';
import { GenerateFromTemplateDto } from './dto/generate-from-template.dto';
import { DocumentTemplate } from './templates/document-template.entity';
import { DocxEngineService } from './templates/docx-engine.service';
import { buildTemplateContext } from './templates/template-data.builder';
import { OFFICIAL_TEMPLATES } from './templates/templates.config';
import {
  buildSafeOnlyOfficeInternalUrl,
  createSignedFileAccessQuery,
  getOnlyOfficeJwtSecret,
  signOnlyOfficeJwt,
  verifyOnlyOfficeCallbackRequest,
  verifySignedFileAccessQuery,
} from './utils/onlyoffice-security.util';
import { adaptToScript, formatAmountNumber, formatDateUzbek } from './utils/transliterate.util';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(ApplicationDocument)
    private readonly documentsRepository: Repository<ApplicationDocument>,
    @InjectRepository(Application)
    private readonly applicationsRepository: Repository<Application>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(DocumentTemplate)
    private readonly templateRepo: Repository<DocumentTemplate>,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
    private readonly docxEngine: DocxEngineService,
  ) {}

  /**
   * Ariza uchun yangi bo'sh rasmiy Word blank yaratish
   */
  async createBlankDocument(
    applicationId: string,
    user: any,
    title?: string,
  ): Promise<ApplicationDocument> {
    const application = await this.applicationsRepository.findOne({
      where: { id: applicationId },
      relations: {
        citizen: true,
        district: true,
        crime: true,
      },
    });

    if (!application) {
      throw new NotFoundException(`Ariza (ID: ${applicationId}) topilmadi`);
    }

    const appNumber = application.application_number || 'AR-YANGI';

    // To'liq bo'm-bo'sh yangi Word hujjati (hech qanday yozuvsiz)
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch (standart 2.54 sm)
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
    const cleanDocTitle = title?.trim() || `Rasmiy hujjat - ${appNumber}`;
    const cleanFileName = `${appNumber}_hujjat_${Date.now()}.docx`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const folder = `documents/${applicationId}`;
    const fileKey = `${folder}/${cleanFileName}`;

    const uploaded = await this.minioService.uploadBuffer(
      buffer,
      fileKey,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      cleanFileName,
    );

    const docKey = `doc_${randomUUID().slice(0, 8)}_${Date.now()}`;

    const appDoc = this.documentsRepository.create({
      application_id: applicationId,
      title: cleanDocTitle,
      file_name: cleanFileName,
      file_key: uploaded.key,
      file_url: uploaded.url,
      file_type: 'docx',
      size: buffer.length,
      version: 1,
      doc_key: docKey,
      created_by_id: user?.id || null,
    });

    return this.documentsRepository.save(appDoc);
  }

  /**
   * Kompyuterdan mavjud Word (.docx / .doc) faylini yuklash va arizaga biriktirish
   */
  async uploadDocument(
    applicationId: string,
    file: Express.Multer.File,
    user: any,
    title?: string,
  ): Promise<ApplicationDocument> {
    const application = await this.applicationsRepository.findOne({
      where: { id: applicationId },
    });

    if (!application) {
      throw new NotFoundException(`Ariza (ID: ${applicationId}) topilmadi`);
    }

    if (!file) {
      throw new BadRequestException('Fayl yuborilmadi');
    }

    const appNumber = application.application_number || 'AR-YANGI';
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'docx';
    const originalNameWithoutExt =
      file.originalname.substring(0, file.originalname.lastIndexOf('.')) || file.originalname;

    const cleanDocTitle = title?.trim() || originalNameWithoutExt;
    const cleanFileName = `${appNumber}_${Date.now()}_${file.originalname}`.replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );
    const folder = `documents/${applicationId}`;
    const fileKey = `${folder}/${cleanFileName}`;

    const uploaded = await this.minioService.uploadBuffer(
      file.buffer,
      fileKey,
      file.mimetype || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      cleanFileName,
    );

    const docKey = `doc_${randomUUID().slice(0, 8)}_${Date.now()}`;

    const appDoc = this.documentsRepository.create({
      application_id: applicationId,
      title: cleanDocTitle,
      file_name: cleanFileName,
      file_key: uploaded.key,
      file_url: uploaded.url,
      file_type: ext,
      size: file.size,
      version: 1,
      doc_key: docKey,
      created_by_id: user?.id || null,
    });

    return this.documentsRepository.save(appDoc);
  }

  /**
   * Arizaga tegishli hujjatlar ro'yxati
   */
  async getDocumentsByApplication(applicationId: string): Promise<ApplicationDocument[]> {
    return this.documentsRepository.find({
      where: { application_id: applicationId },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Bitta hujjatni ID bo'yicha olish
   */
  async getDocumentById(id: string): Promise<ApplicationDocument> {
    const doc = await this.documentsRepository.findOne({
      where: { id },
      relations: {
        application: true,
      },
    });

    if (!doc) {
      throw new NotFoundException(`Hujjat (ID: ${id}) topilmadi`);
    }

    return doc;
  }

  /**
   * ONLYOFFICE uchun tahrirlash konfiguratsiyasini shakllantirish
   */
  async getDocumentEditorConfig(id: string, user: any) {
    const doc = await this.getDocumentById(id);

    // Docker tarmog'idagi ichki server URL
    const internalServerHost =
      this.configService.get<string>('ONLYOFFICE_SERVER_INTERNAL_HOST') || 'uvd_app_server:3000';
    const onlyOfficeSecret = getOnlyOfficeJwtSecret(this.configService);
    const signedQuery = createSignedFileAccessQuery('doc', doc.id, onlyOfficeSecret, 3600);

    const fileUrl = `http://${internalServerHost}/documents/${doc.id}/file?${signedQuery}`;
    const callbackUrl = `http://${internalServerHost}/documents/${doc.id}/callback`;

    const userName = user
      ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Xodim'
      : 'Xodim';

    // Har bir tahrirlash sessiyasiga xatosiz va toza key
    const docKey = doc.doc_key || `doc_${doc.id}_${new Date(doc.updated_at).getTime()}`;

    const editorPayload = {
      documentType: 'word',
      document: {
        fileType: doc.file_type || 'docx',
        key: docKey,
        title:
          doc.file_name.endsWith('.docx') || doc.file_name.endsWith('.doc')
            ? doc.file_name
            : `${doc.title}.${doc.file_type || 'docx'}`,
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
          chat: false,
        },
      },
      editorConfig: {
        callbackUrl,
        user: {
          id: user?.id ? String(user.id) : `user_${doc.id.slice(0, 8)}`,
          name: userName,
        },
        mode: 'edit',
        lang: 'ru', // ONLYOFFICE da 'uz' mavjud emasligi sababli 404 oldini olish
        coEditing: {
          mode: 'fast',
          change: true,
        },
        customization: {
          uiTheme: 'theme-classic-light',
          autosave: true,
          forcesave: true,
          chat: false,
          comments: true,
          help: false,
          toolbarNoTabs: false,
          compactHeader: false,
          feedback: false,
        },
      },
    };

    const token = signOnlyOfficeJwt(editorPayload, onlyOfficeSecret);

    return {
      ...editorPayload,
      token,
      documentId: doc.id,
      applicationId: doc.application_id,
      title: doc.title,
    };
  }

  verifySignedFileAccess(id: string, exp?: string, sig?: string): boolean {
    const onlyOfficeSecret = getOnlyOfficeJwtSecret(this.configService);
    return verifySignedFileAccessQuery('doc', id, exp, sig, onlyOfficeSecret);
  }

  /**
   * ONLYOFFICE dan hujjat saqlanganda keladigan callback handler
   */
  async handleCallback(id: string, body: any, req?: any): Promise<{ error: number }> {
    const onlyOfficeSecret = getOnlyOfficeJwtSecret(this.configService);
    const verifiedPayload = req
      ? verifyOnlyOfficeCallbackRequest(req, body, onlyOfficeSecret)
      : body;

    const status = verifiedPayload?.status ?? body?.status;
    this.logger.log(`ONLYOFFICE callback keldi (Doc ID: ${id}, Status: ${status})`);

    // 2 = Document is ready for saving, 6 = Document being edited, but force-saved
    if (status === 2 || status === 6) {
      const downloadUrl: string = (verifiedPayload?.url as string) || body?.url;
      if (!downloadUrl) {
        this.logger.warn(`Callbackda status ${status} bo'lsa-da yuklab olish URL si yo'q`);
        return { error: 0 };
      }

      try {
        // SSRF himoyasi: faqat ichki ishonchli ONLYOFFICE konteyneridan yuklab olamiz
        const internalBaseUrl =
          this.configService.get<string>('ONLYOFFICE_INTERNAL_URL') || 'http://uvd_app_onlyoffice';
        const targetUrl = buildSafeOnlyOfficeInternalUrl(downloadUrl, internalBaseUrl);

        this.logger.log(`ONLYOFFICE ichki yuklab olish URL: ${targetUrl}`);

        const response = await fetch(targetUrl);
        if (!response.ok) {
          throw new Error(`Faylni yuklab olishda xatolik: HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const doc = await this.getDocumentById(id);

        // MinIO ga yangilangan Word faylini yozish
        await this.minioService.uploadBuffer(
          buffer,
          doc.file_key,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          doc.file_name,
        );

        // Yangi versiya va yangi doc_key belgilash (kesh to'qnashuvlarini oldini olish)
        doc.version += 1;
        doc.size = buffer.length;
        doc.doc_key = `doc_${randomUUID().slice(0, 8)}_${Date.now()}`;
        await this.documentsRepository.save(doc);

        this.logger.log(
          `Hujjat (ID: ${id}) muvaffaqiyatli saqlandi va yangilandi (v${doc.version}, hajmi: ${doc.size} bayt)`,
        );
      } catch (err) {
        this.logger.error(`ONLYOFFICE hujjatini saqlashda xatolik yuz berdi:`, err);
        return { error: 1 };
      }
    }

    return { error: 0 };
  }

  /**
   * Hujjat faylini oqim (stream) sifatida berish (ONLYOFFICE yoki yuklab olish uchun)
   */
  async getFileStream(id: string) {
    const doc = await this.getDocumentById(id);
    const stream = await this.minioService.getFileStream(doc.file_key);
    return {
      stream,
      document: doc,
    };
  }

  /**
   * Hujjatni o'chirish
   */
  async deleteDocument(id: string): Promise<boolean> {
    const doc = await this.getDocumentById(id);
    try {
      await this.minioService.deleteFile(doc.file_key);
    } catch (e) {
      this.logger.warn(`MinIO dan faylni o'chirishda ogohlantirish: ${e}`);
    }

    await this.documentsRepository.remove(doc);
    return true;
  }

  /**
   * Tizimdagi mavjud rasmiy shablonlar ro'yxatini olish
   */
  async getAvailableTemplates(script: 'lotin' | 'krill' = 'lotin') {
    const blank = {
      id: 'blank',
      title: script === 'krill' ? 'Бўш Word ҳужжат (шаблонсиз)' : 'Bo‘sh Word hujjat (shablonsiz)',
      defaultDocTitle: script === 'krill' ? 'Янги ҳужжат' : 'Yangi hujjat',
      description:
        script === 'krill'
          ? 'Ҳеч қандай ёзувсиз бўм-бўш тоза Word blank яратиш ва ONLYOFFICE да эркин ёзиш'
          : 'Hech qanday yozuvsiz bo‘m-bo‘sh toza Word blank yaratish va ONLYOFFICE da erkin yozish',
      category: 'Bo‘sh blank',
      pageCount: 1,
      isDynamic: false,
      fields: [],
    };

    // 1. Dinamik universal shablonlar (bazadan)
    let dynamicTemplates: any[] = [];
    try {
      const dbTemplates = await this.templateRepo.find({
        where: { is_active: true },
        order: { created_at: 'ASC' },
      });

      dynamicTemplates = dbTemplates.map((t) => ({
        id: t.id,
        title: script === 'krill' && t.title_krill ? t.title_krill : t.title,
        defaultDocTitle: script === 'krill' && t.title_krill ? t.title_krill : t.title,
        description: t.description || '',
        category: t.category || 'Shablon',
        pageCount: 1,
        isDynamic: true,
        availableTags: t.available_tags || [],
        fields: [],
      }));
    } catch (e) {
      this.logger.warn(`Baza shablonlarini yuklashda ogohlantirish: ${e}`);
    }

    const legacyTemplates = OFFICIAL_TEMPLATES.map((tmpl) => ({
      id: tmpl.id,
      title: script === 'krill' ? tmpl.titleKrill : tmpl.title,
      defaultDocTitle: script === 'krill' ? tmpl.defaultDocTitleKrill : tmpl.defaultDocTitle,
      description: script === 'krill' ? tmpl.descriptionKrill : tmpl.description,
      category: tmpl.category,
      pageCount: tmpl.pageCount,
      isDynamic: false,
      fields: tmpl.fields,
    }));

    return [blank, ...dynamicTemplates, ...legacyTemplates];
  }

  /**
   * Foydalanuvchi ma'lumotlarini authId orqali topish
   */
  private async resolveOfficerName(user: any): Promise<string> {
    if (!user) return 'Xodim';
    if (user.first_name || user.last_name) {
      return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    const authId = user.sub || user.id;
    if (authId) {
      try {
        const dbUser = await this.usersRepository.findOne({ where: { auth_id: authId } });
        if (dbUser && (dbUser.first_name || dbUser.last_name)) {
          return `${dbUser.first_name || ''} ${dbUser.last_name || ''}`.trim();
        }
      } catch (e) {
        this.logger.warn(`Foydalanuvchi ismini yuklashda ogohlantirish: ${e}`);
      }
    }
    return user.username || 'Xodim';
  }

  /**
   * Tanlangan shablon uchun ariza ma'lumotlarini avtomatik to'ldirib berish (Preview)
   */
  async getTemplatePreview(
    applicationId: string,
    templateId: string,
    script: 'lotin' | 'krill' = 'lotin',
    user?: any,
  ) {
    const application = await this.applicationsRepository.findOne({
      where: { id: applicationId },
      relations: {
        citizen: { district: true, mahalla: true },
        district: true,
        crime: true,
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: { bank: true },
          receiver_card: { bank: true },
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

    if (!application) {
      throw new NotFoundException(`Ariza (ID: ${applicationId}) topilmadi`);
    }

    if (templateId === 'blank') {
      return {
        template: {
          id: 'blank',
          title:
            script === 'krill' ? 'Бўш Word ҳужжат (шаблонсиз)' : 'Bo‘sh Word hujjat (shablonsiz)',
          defaultDocTitle: script === 'krill' ? 'Янги ҳужжат' : 'Yangi hujjat',
          description:
            script === 'krill'
              ? 'Ҳеч қандай ёзувсиз бўм-бўш тоза Word blank яратиш ва ONLYOFFICE да эркин ёзиш'
              : 'Hech qanday yozuvsiz bo‘m-bo‘sh toza Word blank yaratish va ONLYOFFICE da erkin yozish',
          category: 'Bo‘sh blank',
          pageCount: 1,
          fields: [],
        },
        prefilledData: {
          documentTitle: script === 'krill' ? 'Янги ҳужжат' : 'Yangi hujjat',
        },
        script,
        applicationNumber: application.application_number,
      };
    }

    // 1. Dinamik universal shablon (ma'lumotlar bazasidan)
    let dbTemplate: DocumentTemplate | null = null;
    try {
      dbTemplate = await this.templateRepo.findOne({ where: { id: templateId } });
    } catch {
      // UUID formatida bo'lmasa, demak eski ID (masalan 'tushuntirish-telegram')
    }

    if (dbTemplate) {
      const transfers = await this.transferRepo.find({
        where: { application_id: applicationId },
        relations: {
          sender_card: true,
          receiver_card: { bank: true },
          payment_provider: true,
        },
      });

      let officerUser: any = null;
      const authId = user?.sub || user?.id;
      if (authId) {
        officerUser = await this.usersRepository.findOne({ where: { auth_id: authId } });
      }

      const context = buildTemplateContext(application, transfers, officerUser, script);

      return {
        template: {
          id: dbTemplate.id,
          title:
            script === 'krill' && dbTemplate.title_krill
              ? dbTemplate.title_krill
              : dbTemplate.title,
          defaultDocTitle:
            script === 'krill' && dbTemplate.title_krill
              ? dbTemplate.title_krill
              : dbTemplate.title,
          description: dbTemplate.description || '',
          category: dbTemplate.category || 'Shablon',
          pageCount: 1,
          isDynamic: true,
          availableTags: dbTemplate.available_tags || [],
          fields: [],
        },
        prefilledData: {
          documentTitle:
            script === 'krill' && dbTemplate.title_krill
              ? dbTemplate.title_krill
              : dbTemplate.title,
          ...context,
        },
        script,
        applicationNumber: application.application_number,
      };
    }

    const template = OFFICIAL_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      throw new NotFoundException(`Shablon topilmadi: ${templateId}`);
    }

    const officerRawName = await this.resolveOfficerName(user);
    const citizen = application.citizen;
    const card = application.card || application.transfer?.sender_card;
    const fraudCard = application.transfer?.receiver_card;

    // F.I.Sh.
    const citizenFullNameRaw = citizen
      ? [citizen.last_name, citizen.first_name, citizen.middle_name].filter(Boolean).join(' ')
      : '';
    const citizenShortNameRaw = citizen?.last_name
      ? `${citizen.first_name ? citizen.first_name[0] + '.' : ''}${citizen.last_name}`
      : citizenFullNameRaw;

    // Manzil
    const addressParts: string[] = [];
    if (application.district?.name || citizen?.district?.name) {
      addressParts.push(application.district?.name || citizen?.district?.name || '');
    }
    if (citizen?.mahalla?.name) {
      addressParts.push(citizen.mahalla.name);
    }
    if (citizen?.address) {
      addressParts.push(citizen.address);
    }
    const citizenAddressRaw = addressParts.filter(Boolean).join(', ');

    // Sana va summa
    const dateFormatted = formatDateUzbek(application.date || new Date(), script);
    const amountFormatted = formatAmountNumber(application.transfer?.amount);

    const isOwnCard =
      !card?.full_name ||
      !citizenFullNameRaw ||
      card.full_name.trim().toLowerCase() === citizenFullNameRaw.trim().toLowerCase();

    const prefilledData: Record<string, string> = {
      headTitle: adaptToScript(
        'Qashqadaryo viloyati IIB boshlig‘i polkovnik A.S.Ismoilovga',
        script,
      ),
      citizenFullName: adaptToScript(citizenFullNameRaw, script),
      citizenShortName: adaptToScript(citizenShortNameRaw, script),
      citizenAddress: adaptToScript(citizenAddressRaw, script),
      citizenPhone: citizen?.phone_number || '',
      citizenBirthDate: citizen?.birth_date ? formatDateUzbek(citizen.birth_date, script) : '',
      maritalStatus: adaptToScript('Oilaliman', script),
      education: adaptToScript('Oliy', script),
      criminalRecord: adaptToScript('sudlanmaganman', script),
      workplace: adaptToScript('vaqtincha ishsiz', script),
      districtName: adaptToScript(
        application.district?.name || citizen?.district?.name || 'Qarshi tumani',
        script,
      ),
      mahallaName: adaptToScript(citizen?.mahalla?.name || '', script),
      cardNumber: card?.card_number || '',
      cardHolder: adaptToScript(card?.full_name || citizenFullNameRaw, script),
      cardBank: adaptToScript(card?.bank?.name || 'Aloqabank ATB', script),
      cardOwnerRelation: adaptToScript(
        isOwnCard ? 'o‘zimga tegishli bo‘lgan' : `${card?.full_name || 'onam'}ga tegishli bo‘lgan`,
        script,
      ),
      fraudCardNumber: fraudCard?.card_number || '',
      fraudCardHolder: adaptToScript(fraudCard?.full_name || 'Tolipov Ziyodbek', script),
      fraudCardBank: adaptToScript(fraudCard?.bank?.name || 'Trastbank ATB', script),
      victimCardNumber: card?.card_number || '',
      victimCardHolder: adaptToScript(card?.full_name || citizenFullNameRaw, script),
      stolenAmount: amountFormatted,
      dateText: dateFormatted,
      officerName: adaptToScript(officerRawName, script),
      officerPosition: adaptToScript(
        'Kiberjinoyatlarga qarshi kurashish bo‘linmasi tezkor vakili',
        script,
      ),
      prosecutorInfo: adaptToScript(
        templateId === 'sanksiya-firibgarlik'
          ? 'Qarshi tumani prokurori adliya katta maslahatchisi T.J.Murodov'
          : 'Qarshi shahar prokurori adliya maslahatchisi U.N.Elmurodov',
        script,
      ),
      phoneModel: 'Iphone 16 Pro max',
      telegramUsagePeriod: adaptToScript('taxminan 3-4 yildan buyon', script),
      compromiseDate: adaptToScript('01 iyul', script),
      friendInfo: adaptToScript('Samarqand viloyatida yashovchi Lochin ismli tanishim', script),
      fakeAppName: adaptToScript('“Road 24” ilovasi', script),
      deductionService: adaptToScript('“LUMO 5”', script),
      deductionTime: adaptToScript('soat 23:14 da', script),
      smsSources: adaptToScript('“sinbad”, “Korzinka”, “Mobiuz_App” va “MyTaxi”', script),
      startTime: '10:00',
      endTime: '10:45',
      witness1: adaptToScript(
        'Qarshi shahri, Mustaqillik MFY 12-uyda yashovchi fuqaro Aliyev Vali',
        script,
      ),
      witness2: adaptToScript(
        'Qarshi shahri, Nasaf MFY 5-uyda yashovchi fuqaro Karimov Salim',
        script,
      ),
      inspectionDescription: adaptToScript(
        `Fuqaro ${citizenFullNameRaw || 'jabrlanuvchi'}ga tegishli bo‘lgan telefon apparati va bank kartasi xolislar ishtirokida ko‘zdan kechirildi hamda qonuniy tartibda olindi.`,
        script,
      ),
    };

    return {
      template: {
        id: template.id,
        title: script === 'krill' ? template.titleKrill : template.title,
        defaultDocTitle:
          script === 'krill' ? template.defaultDocTitleKrill : template.defaultDocTitle,
        description: script === 'krill' ? template.descriptionKrill : template.description,
        category: template.category,
        pageCount: template.pageCount,
        fields: template.fields,
      },
      prefilledData,
      script,
      applicationNumber: application.application_number,
    };
  }

  /**
   * Shablon asosida avtomatik to'ldirilgan Word (.docx) hujjati yaratish
   */
  async createFromTemplate(
    applicationId: string,
    dto: GenerateFromTemplateDto,
    user: any,
  ): Promise<ApplicationDocument> {
    const script = dto.script || 'lotin';

    // 1. Agar foydalanuvchi bo'sh Word hujjat tanlagan bo'lsa
    if (dto.templateId === 'blank') {
      const cleanTitle = dto.title?.trim() || (script === 'krill' ? 'Янги ҳужжат' : 'Yangi hujjat');
      return this.createBlankDocument(applicationId, user, cleanTitle);
    }

    // 2. Dinamik universal shablon (ma'lumotlar bazasidan)
    let dbTemplate: DocumentTemplate | null = null;
    try {
      dbTemplate = await this.templateRepo.findOne({ where: { id: dto.templateId } });
    } catch {
      // UUID bo'lmasa, demak legacy ID
    }

    if (dbTemplate) {
      const application = await this.applicationsRepository.findOne({
        where: { id: applicationId },
        relations: {
          citizen: { district: true, mahalla: true },
          district: true,
          crime: true,
          card: { bank: true, citizen: true },
          transfer: {
            payment_provider: true,
            sender_card: { bank: true },
            receiver_card: { bank: true },
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

      if (!application) {
        throw new NotFoundException(`Ariza (ID: ${applicationId}) topilmadi`);
      }

      const transfers = await this.transferRepo.find({
        where: { application_id: applicationId },
        relations: {
          sender_card: true,
          receiver_card: { bank: true },
          payment_provider: true,
        },
      });

      let officerUser: any = null;
      const authId = user?.sub || user?.id;
      if (authId) {
        officerUser = await this.usersRepository.findOne({ where: { auth_id: authId } });
      }

      const context = buildTemplateContext(
        application,
        transfers,
        officerUser,
        script,
        dto.customData || {},
      );

      // Shablon faylini MinIO dan o'qish
      const fileKey =
        script === 'krill' && dbTemplate.file_key_krill
          ? dbTemplate.file_key_krill
          : dbTemplate.file_key;

      const stream = await this.minioService.getFileStream(fileKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const templateBuffer = Buffer.concat(chunks);

      const generatedBuffer = this.docxEngine.renderTemplate(templateBuffer, context);

      const defaultDocTitle =
        dto.title?.trim() ||
        (script === 'krill' && dbTemplate.title_krill ? dbTemplate.title_krill : dbTemplate.title);

      const appNumber = application.application_number || 'YANGI';
      const safeTitlePart = defaultDocTitle
        .replace(/[^a-zA-Z0-9а-яА-ЯўқғҳЎҚҒҲ._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 40);
      const cleanFileName = `${appNumber}_${safeTitlePart}_${Date.now()}.docx`;
      const folder = `documents/${applicationId}`;
      const uploadFileKey = `${folder}/${cleanFileName}`;

      const uploaded = await this.minioService.uploadBuffer(
        generatedBuffer,
        uploadFileKey,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        cleanFileName,
      );

      const docKey = `doc_${randomUUID().slice(0, 8)}_${Date.now()}`;

      const appDoc = this.documentsRepository.create({
        application_id: applicationId,
        title: defaultDocTitle,
        file_name: cleanFileName,
        file_key: uploaded.key,
        file_url: uploaded.url,
        file_type: 'docx',
        size: generatedBuffer.length,
        version: 1,
        doc_key: docKey,
        created_by_id: user?.sub || user?.id || null,
      });

      const saved = await this.documentsRepository.save(appDoc);
      this.logger.log(`Universal shablondan hujjat yaratildi: ${saved.title} (ID: ${saved.id})`);
      return saved;
    }

    const template = OFFICIAL_TEMPLATES.find((t) => t.id === dto.templateId);
    if (!template) {
      throw new BadRequestException(`Shablon topilmadi: ${dto.templateId}`);
    }

    const fileName = script === 'krill' ? template.krillFileName : template.lotinFileName;
    const templateFilePath = this.resolveTemplateFilePath(script, fileName);

    const application = await this.applicationsRepository.findOne({
      where: { id: applicationId },
      relations: {
        citizen: { district: true, mahalla: true },
        district: true,
        crime: true,
        card: { bank: true, citizen: true },
        transfer: {
          payment_provider: true,
          sender_card: { bank: true },
          receiver_card: { bank: true },
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

    if (!application) {
      throw new NotFoundException(`Ariza (ID: ${applicationId}) topilmadi`);
    }

    const preview = await this.getTemplatePreview(applicationId, dto.templateId, script, user);
    // Foydalanuvchi kiritgan customData mavjud bo'lsa, avtomatik to'ldirilgan ma'lumotlar bilan birlashtiramiz
    const finalData: Record<string, any> = {
      ...preview.prefilledData,
      ...(dto.customData || {}),
    };

    // Faylni o'qish
    const fileBuffer = fs.readFileSync(templateFilePath);
    const zip = await JSZip.loadAsync(fileBuffer);

    let docXml = await zip.file('word/document.xml')?.async('text');
    if (!docXml) {
      throw new BadRequestException('Word hujjati tuzilmasi (word/document.xml) topilmadi');
    }

    // Almashtirishlar qoidalarini shakllantirish
    const replacements = this.getReplacementsForTemplate(template.id, script, finalData);

    // document.xml dagi barcha paragraflarda almashtirish
    docXml = docXml.replace(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g, (pXml) => {
      let current = pXml;
      for (const r of replacements) {
        current = this.replaceInParagraphXml(current, r.search, r.replace);
      }
      return current;
    });

    zip.file('word/document.xml', docXml);

    // Agar header yoki footer mavjud bo'lsa, ularni ham yangilaymiz
    const headerFiles = Object.keys(zip.files).filter(
      (k) => k.startsWith('word/header') && k.endsWith('.xml'),
    );
    for (const hf of headerFiles) {
      let hXml = await zip.file(hf)?.async('text');
      if (hXml) {
        hXml = hXml.replace(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g, (pXml) => {
          let current = pXml;
          for (const r of replacements) {
            current = this.replaceInParagraphXml(current, r.search, r.replace);
          }
          return current;
        });
        zip.file(hf, hXml);
      }
    }

    const generatedBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Qisqa va toza hujjat nomi: hodim kiritgan nom yoki shablonning qisqa default nomi
    const defaultDocTitle =
      dto.title?.trim() ||
      (script === 'krill' ? template.defaultDocTitleKrill : template.defaultDocTitle) ||
      template.title;

    const safeTitlePart = defaultDocTitle
      .replace(/[^a-zA-Z0-9а-яА-ЯўқғҳЎҚҒҲ._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 40);
    const cleanFileName = `${safeTitlePart}_${Date.now()}.docx`;
    const folder = `documents/${applicationId}`;
    const fileKey = `${folder}/${cleanFileName}`;

    const uploaded = await this.minioService.uploadBuffer(
      generatedBuffer,
      fileKey,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      cleanFileName,
    );

    const docKey = `doc_${randomUUID().slice(0, 8)}_${Date.now()}`;

    const appDoc = this.documentsRepository.create({
      application_id: applicationId,
      title: defaultDocTitle,
      file_name: cleanFileName,
      file_key: uploaded.key,
      file_url: uploaded.url,
      file_type: 'docx',
      size: generatedBuffer.length,
      version: 1,
      doc_key: docKey,
      created_by_id: user?.sub || user?.id || null,
    });

    const saved = await this.documentsRepository.save(appDoc);
    this.logger.log(`Shablondan hujjat muvaffaqiyatli yaratildi: ${saved.title} (ID: ${saved.id})`);
    return saved;
  }

  /**
   * Shablon fayli diskda mavjud bo'lgan joyni aniqlash
   */
  private resolveTemplateFilePath(script: 'lotin' | 'krill', fileName: string): string {
    const candidatePaths = [
      path.join(process.cwd(), 'templates', script, fileName),
      path.join(process.cwd(), 'server', 'templates', script, fileName),
      path.join(__dirname, '../../../../templates', script, fileName),
      path.join(__dirname, '../../../../../templates', script, fileName),
      `/usr/src/app/templates/${script}/${fileName}`,
      path.join(process.cwd(), 'docx_templates', script, fileName),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    throw new NotFoundException(`Shablon fayli topilmadi: ${fileName} (${script})`);
  }

  /**
   * Paragraf ichidagi ajratilgan run'lar (<w:t>) o'rtasida xatosiz matn almashtirish
   */
  private replaceInParagraphXml(pXml: string, search: string, replacement: string): string {
    if (!search || replacement === undefined || search === replacement) return pXml;
    let currentXml = pXml;
    let searchFrom = 0;
    let safety = 0;

    while (safety++ < 50) {
      const tTagRegex = /(<w:t(?: [^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
      const tNodes: Array<{
        fullMatch: string;
        openTag: string;
        text: string;
        closeTag: string;
        start: number;
        end: number;
        indexInXml: number;
        lengthInXml: number;
        newText?: string;
      }> = [];
      let match: RegExpExecArray | null;
      let combined = '';

      while ((match = tTagRegex.exec(currentXml)) !== null) {
        const start = combined.length;
        const text = match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        combined += text;
        tNodes.push({
          fullMatch: match[0],
          openTag: match[1],
          text,
          closeTag: match[3],
          start,
          end: combined.length,
          indexInXml: match.index,
          lengthInXml: match[0].length,
        });
      }

      const matchIdx = combined.indexOf(search, searchFrom);
      if (matchIdx === -1) break;

      const matchEnd = matchIdx + search.length;
      let firstIdx = -1;
      let lastIdx = -1;

      for (let i = 0; i < tNodes.length; i++) {
        const node = tNodes[i];
        if (firstIdx === -1 && node.end > matchIdx) {
          firstIdx = i;
        }
        if (node.start < matchEnd) {
          lastIdx = i;
        }
      }

      if (firstIdx === -1 || lastIdx === -1) break;

      for (let i = firstIdx; i <= lastIdx; i++) {
        const node = tNodes[i];
        let newText = '';
        if (i === firstIdx && i === lastIdx) {
          const before = node.text.substring(0, matchIdx - node.start);
          const after = node.text.substring(matchEnd - node.start);
          newText = before + replacement + after;
        } else if (i === firstIdx) {
          const before = node.text.substring(0, matchIdx - node.start);
          newText = before + replacement;
        } else if (i === lastIdx) {
          const after = node.text.substring(matchEnd - node.start);
          newText = after;
        } else {
          newText = '';
        }
        node.newText = newText;
      }

      let nextXml = currentXml;
      for (let i = lastIdx; i >= firstIdx; i--) {
        const node = tNodes[i];
        const textVal = node.newText || '';
        const xmlSpace =
          textVal.startsWith(' ') || textVal.endsWith(' ') ? ' xml:space="preserve"' : '';
        const replacementXml = `<w:t${xmlSpace}>${textVal
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</w:t>`;
        nextXml =
          nextXml.substring(0, node.indexInXml) +
          replacementXml +
          nextXml.substring(node.indexInXml + node.lengthInXml);
      }
      currentXml = nextXml;
      // CRITICAL: Advance searchFrom beyond the inserted replacement text so we NEVER re-replace inside replacement!
      searchFrom = matchIdx + replacement.length;
    }
    return currentXml;
  }

  /**
   * Shablon uchun qidirish va almashtirish juftliklarini shakllantirish
   */
  private getReplacementsForTemplate(
    templateId: string,
    script: 'lotin' | 'krill',
    data: Record<string, string>,
  ): Array<{ search: string; replace: string }> {
    const list: Array<{ search: string; replace: string }> = [];

    // 1. Standart placeholderlar (agar docx da {{...}} ko'rinishida bo'lsa)
    const placeholderMap: Record<string, string> = {
      '{{FUQARO_FIO}}': data.citizenFullName,
      '{{CITIZEN_FULL_NAME}}': data.citizenFullName,
      '{{FUQARO_QISQA}}': data.citizenShortName,
      '{{CITIZEN_SHORT_NAME}}': data.citizenShortName,
      '{{FUQARO_MANZIL}}': data.citizenAddress,
      '{{CITIZEN_ADDRESS}}': data.citizenAddress,
      '{{FUQARO_TEL}}': data.citizenPhone,
      '{{CITIZEN_PHONE}}': data.citizenPhone,
      '{{FUQARO_TUGILGAN}}': data.citizenBirthDate,
      '{{CITIZEN_BIRTH_DATE}}': data.citizenBirthDate,
      '{{KARTA_RAQAM}}': data.cardNumber,
      '{{CARD_NUMBER}}': data.cardNumber,
      '{{KARTA_EGASI}}': data.cardHolder,
      '{{CARD_HOLDER}}': data.cardHolder,
      '{{KARTA_BANK}}': data.cardBank,
      '{{CARD_BANK}}': data.cardBank,
      '{{FIRIBGAR_KARTA}}': data.fraudCardNumber,
      '{{FRAUD_CARD_NUMBER}}': data.fraudCardNumber,
      '{{FIRIBGAR_EGASI}}': data.fraudCardHolder,
      '{{FRAUD_CARD_HOLDER}}': data.fraudCardHolder,
      '{{SUMMA}}': data.stolenAmount,
      '{{AMOUNT}}': data.stolenAmount,
      '{{TUMAN}}': data.districtName,
      '{{DISTRICT}}': data.districtName,
      '{{SANA}}': data.dateText,
      '{{DATE}}': data.dateText,
      '{{HODIM_FIO}}': data.officerName,
      '{{OFFICER_NAME}}': data.officerName,
      '{{HODIM_LAVOZIM}}': data.officerPosition,
      '{{OFFICER_POSITION}}': data.officerPosition,
      '{{TELEFON_RUSUMI}}': data.phoneModel,
      '{{PHONE_MODEL}}': data.phoneModel,
      '{{ILOVA_NOMI}}': data.fakeAppName,
      '{{APP_NAME}}': data.fakeAppName,
    };

    for (const [ph, val] of Object.entries(placeholderMap)) {
      if (val) list.push({ search: ph, replace: val });
    }

    // 2. Namuna fayllaridagi original real ma'lumotlarni almashtirish
    const isDefaultHead = Boolean(
      data.headTitle &&
      (data.headTitle.includes('Ismoilov') || data.headTitle.includes('Исмоилов')),
    );

    if (templateId === 'tushuntirish-telegram') {
      if (script === 'lotin') {
        if (data.headTitle && !isDefaultHead) {
          list.push({ search: 'Qashqadaryo viloyati IIB boshlig‘i   polkovnik', replace: '' });
          list.push({ search: 'Qashqadaryo viloyati IIB boshlig‘i polkovnik', replace: '' });
          list.push({ search: 'A.S.Ismoilovga', replace: data.headTitle });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Ergashev Sanjar Togaymurodovich', replace: data.citizenFullName });
        }
        if (data.citizenShortName || data.citizenFullName) {
          list.push({
            search: 'S.Ergashev',
            replace: data.citizenShortName || data.citizenFullName,
          });
        }
        if (data.citizenAddress) {
          list.push({
            search:
              'Qashqadaryo viloyati, Qarshi tumani, Fayzobod MFY, O‘zbekiston mustaqilligi ko‘chasi 15-uy',
            replace: data.citizenAddress,
          });
        }
        if (data.citizenPhone) {
          list.push({ search: '+99897 222 25 25', replace: data.citizenPhone });
        }
        if (data.citizenBirthDate) {
          list.push({
            search: '«09» iyun 1978 yil, Qarshi tumani',
            replace: data.citizenBirthDate,
          });
        }
        if (data.maritalStatus) {
          list.push({ search: 'Oilaliman, 3 nafar farzandim bor', replace: data.maritalStatus });
        }
        if (data.education) {
          list.push({
            search:
              'Oliy, Qarshi muhandislik iqtisodiyot institui 2001 yilda bakalavriat, Janubiy Koreyada 2003 yilda magistraturani',
            replace: data.education,
          });
        }
        if (data.criminalRecord) {
          list.push({ search: 'sudlanmaganman', replace: data.criminalRecord });
        }
        if (data.workplace) {
          list.push({ search: 'tadbirkor', replace: data.workplace });
        }
        if (data.phoneModel) {
          list.push({ search: '“Iphone 16 Pro max”', replace: `“${data.phoneModel}”` });
          list.push({ search: 'Iphone 16 Pro max', replace: data.phoneModel });
        }
        if (data.telegramUsagePeriod) {
          list.push({ search: 'taxminan 3-4 yildan buyon', replace: data.telegramUsagePeriod });
        }
        if (data.compromiseDate) {
          list.push({ search: '01 iyul', replace: data.compromiseDate });
        }
        if (data.friendInfo) {
          list.push({
            search: 'Samarqand viloyatida yashovchi Lochin ismli tanishim',
            replace: data.friendInfo,
          });
          list.push({
            search: 'tanishim Samarqand viloyatida yashovchi Lochin ismli fuqaro',
            replace: `tanishim ${data.friendInfo}`,
          });
          list.push({ search: 'tanishim Lochinga', replace: `tanishim ${data.friendInfo}ga` });
        }
        if (data.stolenAmount) {
          list.push({ search: '2 500 000 so‘m', replace: `${data.stolenAmount} so‘m` });
          list.push({ search: '2 500 000 so‘m', replace: `${data.stolenAmount} so‘m` });
          list.push({ search: '2 500 000', replace: data.stolenAmount });
          list.push({ search: '2 500 000', replace: data.stolenAmount });
        }
        if (data.officerName) {
          list.push({ search: 'D.Umarov', replace: data.officerName });
        }
        if (data.officerPosition) {
          list.push({ search: 'katta serjant', replace: data.officerPosition });
        }
      } else {
        if (data.headTitle && !isDefaultHead) {
          list.push({ search: 'Қашқадарё вилояти ИИБ бошлиғи   полковник', replace: '' });
          list.push({ search: 'Қашқадарё вилояти ИИБ бошлиғи полковник', replace: '' });
          list.push({ search: 'А.С.Исмоиловга', replace: data.headTitle });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Эргашев Санжар Тогаймуродович', replace: data.citizenFullName });
        }
        if (data.citizenShortName || data.citizenFullName) {
          list.push({
            search: 'С.Эргашев',
            replace: data.citizenShortName || data.citizenFullName,
          });
        }
        if (data.citizenAddress) {
          list.push({
            search:
              'Қашқадарё вилояти, Қарши тумани, Файзобод МФЙ, Ўзбекистон мустақиллиги кўчаси 15-уй',
            replace: data.citizenAddress,
          });
        }
        if (data.citizenPhone) {
          list.push({ search: '+99897 222 25 25', replace: data.citizenPhone });
        }
        if (data.citizenBirthDate) {
          list.push({ search: '«09» июнь 1978 йил, Қарши тумани', replace: data.citizenBirthDate });
          list.push({ search: '«09» июн 1978 йил, Қарши тумани', replace: data.citizenBirthDate });
        }
        if (data.maritalStatus) {
          list.push({ search: 'Оилалиман, 3 нафар фарзандим бор', replace: data.maritalStatus });
        }
        if (data.education) {
          list.push({
            search:
              'Олий, Қарши муҳандислик иқтисодиёт институи 2001 йилда бакалавриат, Жанубий Кореяда 2003 йилда магистратурани',
            replace: data.education,
          });
        }
        if (data.criminalRecord) {
          list.push({ search: 'судланмаганман', replace: data.criminalRecord });
        }
        if (data.workplace) {
          list.push({ search: 'тадбиркор', replace: data.workplace });
        }
        if (data.phoneModel) {
          list.push({ search: '“Iphone 16 Pro max”', replace: `“${data.phoneModel}”` });
          list.push({ search: 'Iphone 16 Pro max', replace: data.phoneModel });
        }
        if (data.telegramUsagePeriod) {
          list.push({ search: 'тахминан 3-4 йилдан буён', replace: data.telegramUsagePeriod });
        }
        if (data.compromiseDate) {
          list.push({ search: '01 июль', replace: data.compromiseDate });
          list.push({ search: '01 июл', replace: data.compromiseDate });
        }
        if (data.friendInfo) {
          list.push({
            search: 'Самарқанд вилоятида яшовчи Лочин исмли танишим',
            replace: data.friendInfo,
          });
          list.push({
            search: 'танишим Самарқанд вилоятида яшовчи Лочин исмли фуқаро',
            replace: data.friendInfo,
          });
          list.push({ search: 'танишим Лочинга', replace: `${data.friendInfo}га` });
          list.push({ search: 'Лочин', replace: data.friendInfo });
        }
        if (data.stolenAmount) {
          list.push({ search: '2 500 000 сўм', replace: `${data.stolenAmount} сўм` });
          list.push({ search: '2 500 000 сўм', replace: `${data.stolenAmount} сўм` });
          list.push({ search: '2 500 000', replace: data.stolenAmount });
          list.push({ search: '2 500 000', replace: data.stolenAmount });
        }
        if (data.officerName) {
          list.push({ search: 'Д.Умаров', replace: data.officerName });
        }
        if (data.officerPosition) {
          list.push({ search: 'катта сержант', replace: data.officerPosition });
        }
      }
    } else if (templateId === 'tushuntirish-apk') {
      if (script === 'lotin') {
        if (data.headTitle && !isDefaultHead) {
          list.push({ search: 'Qashqadaryo viloyati IIB boshlig‘i   polkovnik', replace: '' });
          list.push({ search: 'Qashqadaryo viloyati IIB boshlig‘i polkovnik', replace: '' });
          list.push({ search: 'A.S.Ismoilovga', replace: data.headTitle });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Xamroev Latifjon Azamat o‘g‘li', replace: data.citizenFullName });
        }
        if (data.citizenAddress) {
          list.push({
            search: 'Qashqadaryo viloyati, Qarshi tumani, Potron MFY, Vatanparvar ko‘chasi 38-uy',
            replace: data.citizenAddress,
          });
        }
        if (data.citizenPhone) {
          list.push({ search: '+99888 042 50 42', replace: data.citizenPhone });
          list.push({ search: '+99850-501-50-42', replace: data.citizenPhone });
        }
        if (data.citizenBirthDate) {
          list.push({
            search: '«20» iyun 2000 yil, Qarshi tumani',
            replace: data.citizenBirthDate,
          });
        }
        if (data.maritalStatus) {
          list.push({ search: 'Oilaliman', replace: data.maritalStatus });
        }
        if (data.education) {
          list.push({
            search: 'Oliy, Chirchiq Davlat Pedagogika universitetini 2024-yilda tugallaganman',
            replace: data.education,
          });
        }
        if (data.criminalRecord) {
          list.push({ search: 'sudlanmaganman', replace: data.criminalRecord });
        }
        if (data.workplace) {
          list.push({ search: 'vaqtincha ishsiz', replace: data.workplace });
        }
        if (data.cardOwnerRelation) {
          list.push({
            search: 'onam Farmonova Gulshod Turdiqulovnaga tegishli bo‘lgan',
            replace: data.cardOwnerRelation,
          });
        }
        if (data.cardHolder) {
          list.push({
            search: 'onam Farmonova Gulshod Turdiqulovnaga',
            replace: `${data.cardHolder}ga`,
          });
          list.push({ search: 'Farmonova Gulshod Turdiqulovna', replace: data.cardHolder });
        }
        if (data.cardNumber) {
          list.push({ search: '9860.0825.1953.1774', replace: data.cardNumber });
          list.push({ search: '9860 0825 1953 1774', replace: data.cardNumber });
        }
        if (data.fakeAppName) {
          list.push({ search: '“Road 24”', replace: `“${data.fakeAppName}”` });
          list.push({ search: 'Road 24', replace: data.fakeAppName });
        }
        if (data.phoneModel) {
          list.push({ search: '“Poso S40”', replace: `“${data.phoneModel}”` });
          list.push({ search: 'Poso S40', replace: data.phoneModel });
        }
        if (data.deductionService) {
          list.push({ search: '“LUMO 5”', replace: `“${data.deductionService}”` });
          list.push({ search: 'LUMO 5', replace: data.deductionService });
        }
        if (data.deductionTime) {
          list.push({ search: 'soat 23:14 da', replace: data.deductionTime });
        }
        if (data.stolenAmount) {
          list.push({ search: '3 350 000 so‘m', replace: `${data.stolenAmount} so‘m` });
          list.push({ search: '3 350 000 so‘m', replace: `${data.stolenAmount} so‘m` });
          list.push({ search: '3 350 000', replace: data.stolenAmount });
          list.push({ search: '3 350 000', replace: data.stolenAmount });
        }
        if (data.smsSources) {
          list.push({
            search: '“sinbad”, “Korzinka”, “Mobiuz_App” va “MyTaxi”',
            replace: data.smsSources,
          });
        }
        if (data.officerName) {
          list.push({ search: 'D.Umarov', replace: data.officerName });
        }
      } else {
        if (data.headTitle && !isDefaultHead) {
          list.push({ search: 'Қашқадарё вилояти ИИБ бошлиғи   полковник', replace: '' });
          list.push({ search: 'Қашқадарё вилояти ИИБ бошлиғи полковник', replace: '' });
          list.push({ search: 'А.С.Исмоиловга', replace: data.headTitle });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Хамроев Латифжон Азамат ўғли', replace: data.citizenFullName });
        }
        if (data.citizenAddress) {
          list.push({
            search: 'Қашқадарё вилояти, Қарши тумани, Потрон МФЙ, Ватанпарвар кўчаси 38-уй',
            replace: data.citizenAddress,
          });
        }
        if (data.citizenPhone) {
          list.push({ search: '+99888 042 50 42', replace: data.citizenPhone });
          list.push({ search: '+99850-501-50-42', replace: data.citizenPhone });
        }
        if (data.citizenBirthDate) {
          list.push({ search: '«20» июнь 2000 йил, Қарши тумани', replace: data.citizenBirthDate });
          list.push({ search: '«20» июн 2000 йил, Қарши тумани', replace: data.citizenBirthDate });
        }
        if (data.maritalStatus) {
          list.push({ search: 'Оилалиман', replace: data.maritalStatus });
        }
        if (data.education) {
          list.push({
            search: 'Олий, Чирчиқ Давлат Педагогика университетини 2024-йилда тугаллаганман',
            replace: data.education,
          });
        }
        if (data.criminalRecord) {
          list.push({ search: 'судланмаганман', replace: data.criminalRecord });
        }
        if (data.workplace) {
          list.push({ search: 'вақтинча ишсиз', replace: data.workplace });
        }
        if (data.cardOwnerRelation) {
          list.push({
            search: 'онам Фармонова Гулшод Турдиқуловнага тегишли бўлган',
            replace: data.cardOwnerRelation,
          });
        }
        if (data.cardHolder) {
          list.push({
            search: 'онам Фармонова Гулшод Турдиқуловнага',
            replace: `${data.cardHolder}га`,
          });
          list.push({ search: 'Фармонова Гулшод Турдиқуловна', replace: data.cardHolder });
        }
        if (data.cardNumber) {
          list.push({ search: '9860.0825.1953.1774', replace: data.cardNumber });
          list.push({ search: '9860 0825 1953 1774', replace: data.cardNumber });
        }
        if (data.fakeAppName) {
          list.push({ search: '“Road 24”', replace: `“${data.fakeAppName}”` });
          list.push({ search: 'Road 24', replace: data.fakeAppName });
        }
        if (data.phoneModel) {
          list.push({ search: '“Poso S40”', replace: `“${data.phoneModel}”` });
          list.push({ search: 'Poso S40', replace: data.phoneModel });
        }
        if (data.deductionService) {
          list.push({ search: '“LUMO 5”', replace: `“${data.deductionService}”` });
          list.push({ search: 'LUMO 5', replace: data.deductionService });
        }
        if (data.deductionTime) {
          list.push({ search: 'соат 23:14 да', replace: data.deductionTime });
        }
        if (data.stolenAmount) {
          list.push({ search: '3 350 000 сўм', replace: `${data.stolenAmount} сўм` });
          list.push({ search: '3 350 000 сўм', replace: `${data.stolenAmount} сўм` });
          list.push({ search: '3 350 000', replace: data.stolenAmount });
          list.push({ search: '3 350 000', replace: data.stolenAmount });
        }
        if (data.smsSources) {
          list.push({
            search: '“sinbad”, “Korzinka”, “Mobiuz_App” ва “MyTaxi”',
            replace: data.smsSources,
          });
        }
        if (data.officerName) {
          list.push({ search: 'Д.Умаров', replace: data.officerName });
        }
      }
    } else if (templateId === 'bayonnoma-1-bet') {
      const isLotin = script === 'lotin';
      if (data.dateText) {
        list.push({
          search: isLotin ? '«___» _________ 2026 yil' : '«___» _________ 2026 йил',
          replace: data.dateText,
        });
      }
      if (data.districtName) {
        list.push({ search: '_____________', replace: data.districtName });
      }
      if (data.startTime) {
        list.push({
          search: isLotin ? 'Boshlandi: soat          da' : 'Бошланди: соат          да',
          replace: isLotin
            ? `Boshlandi: soat ${data.startTime} da`
            : `Бошланди: соат ${data.startTime} да`,
        });
      }
      if (data.endTime) {
        list.push({
          search: isLotin ? 'Tugallandi: soat          da' : 'Тугалланди: соат          да',
          replace: isLotin
            ? `Tugallandi: soat ${data.endTime} da`
            : `Тугалланди: соат ${data.endTime} да`,
        });
      }
      if (data.witness1) {
        list.push({
          search:
            '1.___________________________________________________________________________________________________________________________________',
          replace: `1. ${data.witness1}`,
        });
      }
      if (data.witness2) {
        list.push({
          search:
            '2.___________________________________________________________________________________________________________________________________',
          replace: `2. ${data.witness2}`,
        });
      }
      if (data.inspectionDescription) {
        list.push({
          search:
            '_____________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________',
          replace: data.inspectionDescription,
        });
      }
      if (data.citizenFullName) {
        list.push({
          search: '______         __________________',
          replace: `______         ${data.citizenFullName}`,
        });
      }
      if (data.officerName) {
        list.push({
          search: '_________  \t      __________________',
          replace: `_________  \t      ${data.officerName}`,
        });
        list.push({
          search: '_________        __________________',
          replace: `_________        ${data.officerName}`,
        });
      }
    } else if (templateId === 'sanksiya-ogrilik') {
      if (script === 'lotin') {
        if (data.prosecutorInfo) {
          list.push({
            search: 'Qarshi shahar prokurori  adliya maslahatchisi   U.N.Elmurodov',
            replace: data.prosecutorInfo,
          });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Haqberdiyev Sardor Azim o‘g‘li', replace: data.citizenFullName });
        }
        if (data.citizenShortName || data.citizenFullName) {
          list.push({
            search: 'S.Haqberdiyev',
            replace: data.citizenShortName || data.citizenFullName,
          });
        }
        if (data.citizenAddress) {
          list.push({
            search: 'Qashqadaryo viloyati, Qarshi tumani Chaman MFY',
            replace: data.citizenAddress,
          });
        }
        if (data.cardNumber) {
          list.push({ search: '9860.1901.1022.9597', replace: data.cardNumber });
        }
        if (data.cardHolder) {
          list.push({ search: 'Jo‘rayeva Navro‘za', replace: data.cardHolder });
        }
        if (data.cardBank) {
          list.push({ search: 'Aloqa banki', replace: data.cardBank });
          list.push({ search: 'Aloqabank', replace: data.cardBank });
        }
        if (data.stolenAmount) {
          list.push({ search: '1.474.650 so‘m', replace: `${data.stolenAmount} so‘m` });
          list.push({ search: '1.474.650', replace: data.stolenAmount });
          list.push({ search: '1 474 650', replace: data.stolenAmount });
        }
        if (data.districtName) {
          list.push({ search: 'Qarshi shahri', replace: data.districtName });
        }
        if (data.officerName) {
          list.push({ search: 'D.Y.Umarov', replace: data.officerName });
          list.push({ search: 'D.Umarov', replace: data.officerName });
        }
        if (data.officerPosition) {
          list.push({ search: 'katta tezkor vakili leytenant', replace: data.officerPosition });
        }
      } else {
        if (data.prosecutorInfo) {
          list.push({
            search: 'Қарши шаҳар прокурори  адлия маслаҳатчиси   У.Н.Элмуродов',
            replace: data.prosecutorInfo,
          });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Ҳақбердиев Сардор Азим ўғли', replace: data.citizenFullName });
        }
        if (data.citizenShortName || data.citizenFullName) {
          list.push({
            search: 'С.Ҳақбердиев',
            replace: data.citizenShortName || data.citizenFullName,
          });
        }
        if (data.citizenAddress) {
          list.push({
            search: 'Қашқадарё вилояти, Қарши тумани Чаман МФЙ',
            replace: data.citizenAddress,
          });
        }
        if (data.cardNumber) {
          list.push({ search: '9860.1901.1022.9597', replace: data.cardNumber });
        }
        if (data.cardHolder) {
          list.push({ search: 'Жўраева Наврўза', replace: data.cardHolder });
        }
        if (data.cardBank) {
          list.push({ search: 'Алоқа банки', replace: data.cardBank });
          list.push({ search: 'Алоқабанк', replace: data.cardBank });
        }
        if (data.stolenAmount) {
          list.push({ search: '1.474.650 сўм', replace: `${data.stolenAmount} сўм` });
          list.push({ search: '1.474.650', replace: data.stolenAmount });
          list.push({ search: '1 474 650', replace: data.stolenAmount });
        }
        if (data.districtName) {
          list.push({ search: 'Қарши шаҳри', replace: data.districtName });
        }
        if (data.officerName) {
          list.push({ search: 'Д.Й.Умаров', replace: data.officerName });
          list.push({ search: 'Д.Умаров', replace: data.officerName });
        }
        if (data.officerPosition) {
          list.push({ search: 'катта тезкор вакили лейтенaнт', replace: data.officerPosition });
          list.push({ search: 'катта тезкор вакили лейтенант', replace: data.officerPosition });
        }
      }
    } else if (templateId === 'sanksiya-firibgarlik') {
      if (script === 'lotin') {
        if (data.prosecutorInfo) {
          list.push({
            search: 'Qarshi tumani prokurori  adliya katta maslahatchisi   T.J.Murodov',
            replace: data.prosecutorInfo,
          });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Xusinova Shoxista Ambiyaqulovna', replace: data.citizenFullName });
        }
        if (data.citizenShortName || data.citizenFullName) {
          list.push({
            search: 'Sh.Xusinova',
            replace: data.citizenShortName || data.citizenFullName,
          });
        }
        if (data.citizenAddress) {
          list.push({
            search: 'Qashqadaryo viloyati, Qarshi tumani Paxtakor MFY, Jayxun ko‘chasi 31-uy',
            replace: data.citizenAddress,
          });
        }
        if (data.fraudCardNumber) {
          list.push({ search: '9860.1801.1076.0402', replace: data.fraudCardNumber });
        }
        if (data.fraudCardHolder) {
          list.push({ search: 'Tolipov Ziyodbek', replace: data.fraudCardHolder });
        }
        if (data.stolenAmount) {
          list.push({ search: '12 600 000 so‘m', replace: `${data.stolenAmount} so‘m` });
          list.push({ search: '12 600 000 so‘m', replace: `${data.stolenAmount} so‘m` });
          list.push({ search: '12 600 000', replace: data.stolenAmount });
          list.push({ search: '12 600 000', replace: data.stolenAmount });
        }
        if (data.fraudCardBank || data.cardBank) {
          list.push({ search: 'Trastbank', replace: data.fraudCardBank || data.cardBank });
        }
        if (data.districtName) {
          list.push({ search: 'Qarshi tumani', replace: data.districtName });
        }
        if (data.officerName) {
          list.push({ search: 'D.Y.Umarov', replace: data.officerName });
          list.push({ search: 'D.Umarov', replace: data.officerName });
        }
      } else {
        if (data.prosecutorInfo) {
          list.push({
            search: 'Қарши тумани прокурори  адлия катта маслаҳатчиси   Т.Ж.Муродов',
            replace: data.prosecutorInfo,
          });
        }
        if (data.citizenFullName) {
          list.push({ search: 'Хусинова Шохиста Амбияқуловна', replace: data.citizenFullName });
        }
        if (data.citizenShortName || data.citizenFullName) {
          list.push({
            search: 'Ш.Хусинова',
            replace: data.citizenShortName || data.citizenFullName,
          });
        }
        if (data.citizenAddress) {
          list.push({
            search: 'Қашқадарё вилояти, Қарши тумани Пахтакор МФЙ, Жайхун кўчаси 31-уй',
            replace: data.citizenAddress,
          });
        }
        if (data.fraudCardNumber) {
          list.push({ search: '9860.1801.1076.0402', replace: data.fraudCardNumber });
        }
        if (data.fraudCardHolder) {
          list.push({ search: 'Толипов Зиёдбек', replace: data.fraudCardHolder });
        }
        if (data.stolenAmount) {
          list.push({ search: '12 600 000 сўм', replace: `${data.stolenAmount} сўм` });
          list.push({ search: '12 600 000 сўм', replace: `${data.stolenAmount} сўм` });
          list.push({ search: '12 600 000', replace: data.stolenAmount });
          list.push({ search: '12 600 000', replace: data.stolenAmount });
        }
        if (data.fraudCardBank || data.cardBank) {
          list.push({ search: 'Трастбанк', replace: data.fraudCardBank || data.cardBank });
        }
        if (data.districtName) {
          list.push({ search: 'Қарши тумани', replace: data.districtName });
        }
        if (data.officerName) {
          list.push({ search: 'Д.Й.Умаров', replace: data.officerName });
          list.push({ search: 'Д.Умаров', replace: data.officerName });
        }
      }
    }

    return list;
  }
}
