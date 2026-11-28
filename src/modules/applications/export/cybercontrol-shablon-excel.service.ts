import * as fs from 'node:fs';
import * as path from 'node:path';

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { sanitizeExcelValue } from '../../../common/utils/excel-style.util';
import { Application, SuspectTreeNode } from '../application.entity';
import { Transfer } from '../transfers/transfer.entity';

interface TemplateReferenceLists {
  viloyat: string;
  tumanlar: string[];
  mahallalar: string[];
  usullar: string[];
  kasblar: string[];
  jinslar: string[];
  holatlar: string[];
  tarmoqlar: string[];
}

@Injectable()
export class CyberControlShablonExcelService {
  private resolveTemplatePath(): string {
    const fileName = 'murojaat_shablon.xlsx';
    const candidates = [
      path.join(process.cwd(), 'templates', fileName),
      path.join(process.cwd(), 'server', 'templates', fileName),
      path.join(process.cwd(), '..', fileName),
      path.join(process.cwd(), fileName),
      `/usr/src/app/templates/${fileName}`,
      path.resolve(__dirname, '../../../../templates', fileName),
      path.resolve(__dirname, '../../../../../templates', fileName),
      path.resolve(__dirname, '../../../../../', fileName),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new InternalServerErrorException(
      'CyberControl Excel shabloni (murojaat_shablon.xlsx) topilmadi',
    );
  }

  async generateWorkbook(
    applications: Application[],
    extraTransfersByAppId?: Map<string, Transfer[]>,
  ): Promise<ExcelJS.Workbook> {
    const templatePath = this.resolveTemplatePath();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    const importSheet = workbook.getWorksheet('Import') ?? workbook.worksheets[0];
    if (!importSheet) {
      throw new InternalServerErrorException('Shablon ichida "Import" sahifasi topilmadi');
    }

    const refs = this.extractReferenceLists(workbook);

    // 2-qatordagi dataValidation qoidalarini saqlab olamiz (barcha keyingi qatorlarga ham qo'llash uchun)
    const colValidations = new Map<number, ExcelJS.DataValidation>();
    for (let col = 1; col <= 17; col++) {
      const dv = importSheet.getCell(2, col).dataValidation;
      if (dv && dv.type) {
        const formulaeCopy: unknown[] = Array.isArray(dv.formulae)
          ? dv.formulae.map((f) => String(f))
          : [];
        colValidations.set(col, { ...dv, formulae: formulaeCopy });
      }
    }

    // Namuna (dummy) 2-qator qiymatlarini tozalaymiz ("Toshkent viloyati", "Aliyev Vali" va h.k. qolmasligi uchun)
    for (let col = 1; col <= 17; col++) {
      importSheet.getCell(2, col).value = null;
    }

    applications.forEach((app, index) => {
      const rowNumber = index + 2;
      const row = importSheet.getRow(rowNumber);
      const extraTransfers = extraTransfersByAppId?.get(app.id) ?? [];

      const values = this.mapApplicationToRowValues(app, refs, extraTransfers);

      for (let col = 1; col <= 17; col++) {
        const cell = row.getCell(col);
        const val = values[col - 1];
        cell.value = val === '' ? null : typeof val === 'string' ? sanitizeExcelValue(val) : val;

        const dv = colValidations.get(col);
        if (dv) {
          const formulaeCopy: unknown[] = Array.isArray(dv.formulae)
            ? dv.formulae.map((f) => String(f))
            : [];
          cell.dataValidation = { ...dv, formulae: formulaeCopy };
        }
      }

      row.commit();
    });

    return workbook;
  }

  private extractReferenceLists(workbook: ExcelJS.Workbook): TemplateReferenceLists {
    const sheet = workbook.getWorksheet('Royxatlar');
    const readCol = (colLetter: string, maxRows: number): string[] => {
      if (!sheet) return [];
      const out: string[] = [];
      for (let r = 1; r <= maxRows; r++) {
        const raw = sheet.getCell(`${colLetter}${r}`).value;
        if (raw !== null && raw !== undefined) {
          const str = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
          if (str.trim().length > 0) {
            out.push(str);
          }
        }
      }
      return out;
    };

    const viloyatList = readCol('A', 10);
    return {
      viloyat: viloyatList[0] || 'Қашқадарё вилояти',
      tumanlar: readCol('B', 50),
      mahallalar: readCol('C', 1500),
      usullar: readCol('D', 100),
      kasblar: readCol('E', 100),
      jinslar: readCol('F', 10),
      holatlar: readCol('G', 20),
      tarmoqlar: readCol('H', 20),
    };
  }

  private mapApplicationToRowValues(
    app: Application,
    refs: TemplateReferenceLists,
    extraTransfers: Transfer[],
  ): Array<string | number | null> {
    const citizen = app.citizen ?? app.custom_fields?.find((cf) => cf.citizen)?.citizen ?? null;

    // 1. Sana (YYYY-MM-DD)
    const dateVal = this.formatDateYMD(app.date || app.created_at);

    // 2. Viloyat
    const viloyatVal = refs.viloyat;

    // 3. Tuman
    const primaryDistrictName = citizen?.district?.name || app.district?.name || '';
    const fallbackDistrictName = app.district?.name || citizen?.district?.name || '';
    const tumanVal =
      this.matchDistrict(primaryDistrictName, refs.tumanlar) ||
      this.matchDistrict(fallbackDistrictName, refs.tumanlar) ||
      '';

    // 4. Neighborhood
    const mahallaVal = this.matchMahalla(citizen?.neighborhood?.name || '', refs.mahallalar);

    // 5. F.I.SH
    const fullName = citizen?.full_name?.trim() || '';

    // 6. Jinsi (Erkak / Ayol)
    const genderVal = this.resolveGender(citizen);

    // 7. Yoshi
    const ageVal = this.resolveAge(citizen, app.date || app.created_at);

    // 8. Telefon (+998XXXXXXXXX)
    const phoneVal = this.formatPhone(citizen?.phone_number || '');

    // 9. Sodir etish usuli
    const methodVal = this.matchCrimeMethod(app, refs.usullar);

    // 10. Kasbi & 11. Kasb izohi
    const kasbVal = this.matchOccupation(
      citizen?.occupation_category?.name || '',
      citizen?.occupation?.name || '',
      refs.kasblar,
    );
    const rawOccName = citizen?.occupation?.name?.trim() || '';
    const workplaceName = (app.workplace?.name || citizen?.workplace?.name || '').trim();
    const workPosition = (app.work_position || citizen?.work_position || '').trim();

    const eduCheckText = this.toAscii(
      `${citizen?.occupation_category?.name || ''} ${rawOccName} ${workplaceName}`,
    );
    const isEducationWorkplace =
      Boolean(workplaceName) &&
      /\b(universitet|institut|litsey|texnikum|kollej|maktab|dmtt|bogcha|talim|akademiy)/.test(
        eduCheckText,
      );

    // 12. O'quv muassasasi & 13. Kurs
    const oquvMuassasasi = isEducationWorkplace ? workplaceName : '';
    let kursVal: number | null = null;
    if (
      workPosition &&
      /\b(talaba|oquvchi|litsey|texnikum|kollej|kurs|sinf)/.test(
        this.toAscii(`${rawOccName} ${workPosition}`),
      )
    ) {
      const kursMatch = workPosition.match(/\b([1-9]|1[0-1])\s*[-.]?\s*(?:kurs|sinf)\b/i);
      if (kursMatch) {
        kursVal = parseInt(kursMatch[1], 10);
      }
    }

    const kasbIzohiParts: string[] = [];
    if (rawOccName && this.toAscii(rawOccName) !== this.toAscii(kasbVal)) {
      kasbIzohiParts.push(rawOccName);
    }
    if (workplaceName && !isEducationWorkplace) {
      kasbIzohiParts.push(workplaceName);
    }
    if (workPosition) {
      kasbIzohiParts.push(workPosition);
    }
    const kasbIzohi = kasbIzohiParts.join(' — ');

    // 14. Ijtimoiy tarmoq
    const socialVal = this.resolveSocialNetwork(app, refs.tarmoqlar);

    // 15. Zarar (so'm)
    const totalLoss = this.calculateTotalLoss(app, extraTransfers);

    // 16. Holat (real ariza statusiga moslashtiramiz, sun'iy "Yangi" yozmaymiz)
    const holatVal = this.resolveStatus(app, refs.holatlar);

    // 17. Fabula
    const fabulaVal = (app.description?.trim() || app.officer_notes?.trim() || '').replace(
      /\s+/g,
      ' ',
    );

    return [
      dateVal,
      viloyatVal,
      tumanVal,
      mahallaVal,
      fullName,
      genderVal,
      ageVal,
      phoneVal,
      methodVal,
      kasbVal,
      kasbIzohi,
      oquvMuassasasi,
      kursVal,
      socialVal,
      totalLoss,
      holatVal,
      fabulaVal,
    ];
  }

  private formatDateYMD(dateInput?: Date | string | null): string {
    const now = new Date();
    let d = dateInput ? new Date(dateInput) : now;
    if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) {
      d = now;
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 9) return `+998${digits}`;
    if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
    return `+${digits}`;
  }

  private resolveGender(
    citizen:
      | {
          gender?: string | null;
          pinfl?: string | null;
          full_name?: string | null;
        }
      | null
      | undefined,
  ): string {
    if (!citizen) return '';
    const g = (citizen.gender || '').toLowerCase().trim();
    if (g === 'female' || g === 'ayol' || g === 'f') return 'Ayol';
    if (g === 'male' || g === 'erkak' || g === 'm') return 'Erkak';

    const pinfl = (citizen.pinfl || '').replace(/\D/g, '');
    if (pinfl.length === 14) {
      const firstDigit = pinfl[0];
      if (firstDigit === '2' || firstDigit === '4' || firstDigit === '6') return 'Ayol';
      if (firstDigit === '1' || firstDigit === '3' || firstDigit === '5') return 'Erkak';
    }

    const full = this.toAscii(citizen.full_name || '');
    if (/\b\w+(ova|eva|ovna|evna|qizi)\b/.test(full)) return 'Ayol';
    if (/\b\w+(ov|ev|ovich|evich|ogli)\b/.test(full)) return 'Erkak';

    return '';
  }

  private resolveStatus(app: Application, options: string[]): string {
    const rawName = (app.application_status?.name || '').trim();
    const code = (app.application_status?.code || app.status || '').toUpperCase();
    const category = String(app.application_status?.category || '').toUpperCase();

    if (rawName && options.length > 0) {
      const exact = options.find((o) => this.toAscii(o) === this.toAscii(rawName));
      if (exact) return exact;
    }

    const findOpt = (substr: string) => options.find((o) => this.toAscii(o).includes(substr));

    if (code === 'HAL_QILINDI' || code.includes('HAL') || code.includes('JI_')) {
      return findOpt('hal') || findOpt('qozgat') || findOpt('yopil') || rawName || '';
    }
    if (code === 'RAD_ETILDI' || code.includes('RAD')) {
      return findOpt('rad') || rawName || '';
    }
    if (
      code === 'JARAYONDA' ||
      code.includes('JARAYON') ||
      category === 'IN_PROGRESS' ||
      category === 'EXTENDED'
    ) {
      return findOpt('jarayon') || findOpt('tekshir') || rawName || '';
    }
    if (code === 'YANGI' || category === 'OPEN' || category === 'NEW') {
      return findOpt('yangi') || rawName || '';
    }
    return rawName || '';
  }

  private resolveAge(
    citizen: { birth_date?: string | Date | null; pinfl?: string | null } | null | undefined,
    refDateInput?: Date | string | null,
  ): number | null {
    if (!citizen) return null;
    const refDate = refDateInput ? new Date(refDateInput) : new Date();
    const validRef = Number.isNaN(refDate.getTime()) ? new Date() : refDate;

    let birthDate: Date | null = null;
    if (citizen.birth_date) {
      const parsed = new Date(citizen.birth_date);
      if (!Number.isNaN(parsed.getTime())) {
        birthDate = parsed;
      }
    }

    if (!birthDate && citizen.pinfl) {
      const pinfl = citizen.pinfl.replace(/\D/g, '');
      if (pinfl.length === 14) {
        const centuryDigit = Number(pinfl[0]);
        const dd = Number(pinfl.slice(1, 3));
        const mm = Number(pinfl.slice(3, 5));
        const yy = Number(pinfl.slice(5, 7));
        let century = 0;
        if (centuryDigit === 1 || centuryDigit === 2) century = 1800;
        else if (centuryDigit === 3 || centuryDigit === 4) century = 1900;
        else if (centuryDigit === 5 || centuryDigit === 6) century = 2000;

        if (century > 0 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
          birthDate = new Date(century + yy, mm - 1, dd);
        }
      }
    }

    if (!birthDate) return null;

    let age = validRef.getFullYear() - birthDate.getFullYear();
    const mDiff = validRef.getMonth() - birthDate.getMonth();
    if (mDiff < 0 || (mDiff === 0 && validRef.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 1 || age > 120) return null;
    return age;
  }

  private matchDistrict(rawDistrict: string, options: string[]): string {
    const trimmed = rawDistrict.trim();
    if (!trimmed || options.length === 0) return '';

    const exact = options.find((o) => o.trim().toLowerCase() === trimmed.toLowerCase());
    if (exact) return exact;

    const norm = this.toAscii(trimmed);
    const isCity = /\b(sh|shahar|shahri)\b/.test(norm);
    const isDistrict = /\b(t|tum|tuman|tumani)\b/.test(norm);

    if (norm.includes('kjqkb') || norm.includes('atsjqkb') || norm.includes('boshqarma')) {
      const kjqkb = options.find((o) => this.toAscii(o).includes('kjqkb'));
      if (kjqkb) return kjqkb;
    }

    // Qarshi va Shahrisabz uchun shahar vs tuman farqini qat'iy tekshiramiz
    if (norm.includes('qarshi') || norm.includes('karshi')) {
      const target = options.find((o) => {
        const oNorm = this.toAscii(o);
        if (!oNorm.includes('qarshi')) return false;
        if (isCity) return /\bsh\b/.test(oNorm);
        if (isDistrict) return /\bt\b/.test(oNorm);
        return true;
      });
      if (target) return target;
    }

    if (norm.includes('shahrisabz') || norm.includes('shaxrisabz')) {
      const target = options.find((o) => {
        const oNorm = this.toAscii(o);
        if (!oNorm.includes('shahrisabz')) return false;
        if (isCity) return /\bsh\b/.test(oNorm);
        if (isDistrict) return /\bt\b/.test(oNorm);
        return true;
      });
      if (target) return target;
    }

    const stripAdminWords = (s: string) =>
      this.toPhoneticKey(
        this.toAscii(s).replace(/\b(tumani|tuman|tum|t|shahri|shahar|sh|viloyati|viloyat)\b/g, ''),
      );

    const candKey = stripAdminWords(trimmed);
    if (!candKey) return '';

    for (const opt of options) {
      const optKey = stripAdminWords(opt);
      if (optKey && (optKey === candKey || optKey.includes(candKey) || candKey.includes(optKey))) {
        return opt;
      }
    }

    return '';
  }

  private matchMahalla(rawMahalla: string, options: string[]): string {
    const trimmed = rawMahalla.trim();
    if (!trimmed || options.length === 0) return '';

    const exact = options.find((o) => o.trim().toLowerCase() === trimmed.toLowerCase());
    if (exact) return exact;

    const stripMahallaNoise = (s: string) =>
      this.toAscii(s)
        .replace(/["'«»„“”.,()-]/g, ' ')
        .replace(/\b(mfy|qfy|ofy|shfy|mahalla|mahallasi|fuqarolar|yigini|m)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const candCore = stripMahallaNoise(trimmed);
    if (!candCore) return '';

    // 1-bosqich: aniq lotinlashtirilgan yadro mosligi
    for (const opt of options) {
      if (stripMahallaNoise(opt) === candCore) {
        return opt;
      }
    }

    // 2-bosqich: fonetik skelet mosligi (masalan: "Charagil" -> "Чароғил  ҚФЙ МФЙ")
    const candPhonetic = this.toPhoneticKey(candCore);
    if (candPhonetic.length >= 3) {
      for (const opt of options) {
        if (this.toPhoneticKey(stripMahallaNoise(opt)) === candPhonetic) {
          return opt;
        }
      }

      // 3-bosqich: qisman o'z ichiga olish (faqat yetarlicha uzun nomlar uchun)
      if (candPhonetic.length >= 5) {
        for (const opt of options) {
          const optPhonetic = this.toPhoneticKey(stripMahallaNoise(opt));
          if (
            optPhonetic.length >= 5 &&
            (optPhonetic.startsWith(candPhonetic) || candPhonetic.startsWith(optPhonetic))
          ) {
            return opt;
          }
        }
      }
    }

    return '';
  }

  private matchCrimeMethod(app: Application, options: string[]): string {
    if (options.length === 0) return app.crime_method?.name || '';

    const methodName = app.crime_method?.name?.trim() || '';
    if (methodName) {
      const methodAscii = this.toAscii(methodName);
      for (const opt of options) {
        const optAscii = this.toAscii(opt);
        if (
          optAscii === methodAscii ||
          optAscii.includes(methodAscii) ||
          methodAscii.includes(optAscii)
        ) {
          return opt;
        }
      }
    }

    const combined = this.toAscii(
      `${methodName} ${app.description || ''} ${app.officer_notes || ''}`,
    );

    const findOpt = (substr: string): string | undefined =>
      options.find((o) => this.toAscii(o).includes(substr));

    const rules: Array<[RegExp, string]> = [
      [/\b(pubg|free\s*fire|steam|akkaunt\s*sotib)\b/, 'pubg va boshqa internet akkauntlari'],
      [
        /\b(apk|zararli|havola|ssilka|silka|link|feyk\s*sayt|fishing)\b/,
        'soxta havola/zararli dastur',
      ],
      [
        /\b(markaziy\s*bank|bank\s*xodim|click\s*xodim|payme\s*xodim|soxta\s*qongiroq|qongiroq\s*qilib|sms\s*kod)\b/,
        'soxta qongiroqlar orqali aldab',
      ],
      [/\b(treyd|treiding|birja|binance|kripto|aksiyalar)\b/, 'soxta treiding yoki onlayn birjada'],
      [/\b(investitsiya|sarmoya|pul\s*kopaytir)\b/, 'turli sohalarga investitsiya kiritish'],
      [
        /\b(mikro\s*qarz|mikroqarz|onlayn\s*kredit|nomiga\s*kredit)\b/,
        'onlayn mikro qarz va kredit',
      ],
      [
        /\b(kompensatsiya|moddiy\s*yordam|bola\s*puli|nafaqa\s*chiqar)\b/,
        'kredit, kompensatsiya, moddiy yordam',
      ],
      [/\b(aksiya|yutuq|sovrin|lotereya)\b/, 'aksiya yoki yutuq chiqqanligi'],
      [/\b(tanishlaridan\s*qarz|akkauntini\s*boshqaruvini)\b/, 'tanishlaridan qarz sorash'],
      [/\b(ijaraga\s*xonadon|kvartira\s*ijara|uy\s*ijara)\b/, 'ijaraga xonadon topib berishni'],
      [/\b(ijaraga|ijara\s*elon)\b/, 'ijaraga berish elonlari'],
      [/\b(telefon\s*savdo|iphone|redmi|samsung\s*sot)\b/, 'telefon savdosi orqali'],
      [
        /\b(olx|avtoelon|uzum|sotuvchi|xaridor|savdo\s*platforma|sotib\s*olish\s*uchun)\b/,
        'onlayn savdo platformalarida',
      ],
      [/\b(chet\s*elga|viza|oqishga\s*kirit|ishga\s*kirit)\b/, 'chet elga ishga yoki oqishga'],
      [/\b(haydovchilik|prava|guvohnoma)\b/, 'haydovchilik guvohnomasi'],
      [/\b(hmqo|prokuratura|tergovchi\s*nomidan|xodimlari\s*nomidan)\b/, 'hmqo xodimlari nomidan'],
      [
        /\b(rahbari\s*nomidan|direktor\s*nomidan|feyk\s*akk)\b/,
        'korxona/tashkilot rahbari nomidan',
      ],
      [/\b(bankomat)\b/, 'yoqotib qoyishi oqibatida (bankomat)'],
      [/\b(kartasini\s*yoqot|yoqotib\s*qoy)\b/, 'plastik kartasini yoqotib qoyishi'],
      [/\b(haqorat|tuhmat|139|140)\b/, 'haqorat va tuhmat'],
      [/\b(meros|xayriya|ehson)\b/, 'meros yoki pul yuborishni'],
      [/\b(kafil)\b/, 'kafil bolganligi'],
      [/\b(telegram)\b/, 'telegram akkauntlari orqali'],
    ];

    for (const [regex, targetSubstr] of rules) {
      if (regex.test(combined)) {
        const matched = findOpt(targetSubstr);
        if (matched) return matched;
      }
    }

    if (!app.description?.trim()) {
      return findOpt('nomalum sharoit') || findOpt('boshqa yollar') || options[0];
    }

    return findOpt('boshqa yollar') || findOpt('nomalum sharoit') || options[0];
  }

  private matchOccupation(categoryName: string, occupationName: string, options: string[]): string {
    if (options.length === 0) return occupationName || categoryName || '';

    const occAscii = this.toAscii(occupationName);
    const catAscii = this.toAscii(categoryName);

    // 1. Avvalo aniq kasb turi (mutaxassisligi) Royxatlar ichida 1-ga-1 bo'lsa, aynan shuni olamiz
    if (occAscii) {
      const exactOcc = options.find((o) => this.toAscii(o) === occAscii);
      if (exactOcc) return exactOcc;
    }

    // 2. Keyin kasb toifasi Royxatlar ichida 1-ga-1 bo'lsa (9 ta asosiy toifaning barchasi Royxatlar'da mavjud!)
    if (catAscii) {
      const exactCat = options.find((o) => this.toAscii(o) === catAscii);
      if (exactCat) return exactCat;
    }

    const combined = `${occAscii} ${catAscii}`.trim();
    if (combined) {
      const findOpt = (substr: string): string | undefined =>
        options.find((o) => this.toAscii(o).includes(substr));

      const rules: Array<[RegExp, string]> = [
        [/\b(chet\s*el|sayyoh|xorijiy\s*(kompaniya|talaba))\b/, 'chet el fuqarolari'],
        [
          /\b(ishsiz|uy\s*bekasi|vaqtincha|mavsumiy|kunlik|migrant|xorijda)\b/,
          'vaqtincha ishsizlar',
        ],
        [/\b(nafaqa|pensioner|qariya|nogiron|boquvchisini)\b/, 'nafaqaxorlar'],
        [/\b(talaba|student|universitet|institut|otm)\b/, 'talabalar'],
        [/\b(maktab\s*oquvchi)\b/, 'maktab oquvchilari'],
        [/\b(litsey|texnikum|kollej)\b/, 'orta-maxsus muassasalari'],
        [/\b(bogcha|maktabgacha|tarbiyachi)\b/, 'maktabgacha talim'],
        [/\b(oqituvchi|muallim|pedagog|ustoz|professor|repetitor)\b/, 'oqituvchi'],
        [/\b(talim)\b/, 'talim tashkilotlari'],
        [
          /\b(shifokor|vrach|hamshira|feldsher|stomatolog|farmatsevt|dorixona|laborant|tibbiyot|tibbiy)\b/,
          'tibbiyot sohasidagi',
        ],
        [/\b(payme|click|uzum|fintex|tolov\s*tashkilot)\b/, 'tolov tashkilotlari'],
        [
          /\b(bank|ipoteka|asaka|kapital|xalq\s*bank|buxgalter|auditor|iqtisodchi|moliyachi|sugurta|mikromoliya)\b/,
          'banklar',
        ],
        [
          /\b(hmqo|harbiy|huquq-tartibot|fvv|favqulodda|sud|prokuratura|adliya|advokat|huquqshunos|yurist)\b/,
          'hmqo organlari',
        ],
        [/\b(savdo|sotuvchi|bozor|dokon|marketpleys|kassir|omborchi)\b/, 'savdo faoliyati'],
        [
          /\b(tadbirkor|yatt|yakka\s*tartib|biznes|mchj|fermer|dehqon|chorvador|bogbon|agronom|veterinar|qishloq)\b/,
          'xususiy sektor tadbirkorlar',
        ],
        [
          /\b(neft|gaz|energetika|elektr\s*tarmoq|zavod|fabrika|sanoat|muhandis|texnolog|tikuvchilik)\b/,
          'yirik korxona',
        ],
        [
          /\b(davlat|hokimiyat|vazirlik|mahalla|soliq|bojxona|kadastr|byudjet|kommunal)\b/,
          'davlat korxona va tashkilotlar',
        ],
        [
          /\b(xizmat\s*korsatish|taksi|haydovchi|kuryer|temir\s*yol|aviatsiya|avtoservis|mexanik|quruvchi|prorab|arxitektor|elektrik|santexnik|payvandchi|oshpaz|ofitsiant|sartarosh|mehmonxona|turizm|qoriqchi|hunarmand|usta|dasturchi|it|dizayner|smm|marketolog|aloqa|telekommunikatsiya|bloger|jurnalist|oav|frilanser)\b/,
          'xizmat korsatish sektori',
        ],
      ];

      for (const [regex, targetSubstr] of rules) {
        if (regex.test(combined)) {
          const matched = findOpt(targetSubstr);
          if (matched) return matched;
        }
      }
    }

    return options.find((o) => this.toAscii(o).includes('vaqtincha ishsizlar')) || options[0];
  }

  private resolveSocialNetwork(app: Application, options: string[]): string {
    const suspectText = this.flattenSuspectTree(app.suspect_tree);
    const combined = this.toAscii(
      `${suspectText} ${app.description || ''} ${app.officer_notes || ''} ${app.crime_method?.name || ''}`,
    );

    const pick = (name: string) =>
      options.find((o) => o.toLowerCase() === name.toLowerCase()) || name;

    if (/\binstagram\b/.test(combined)) return pick('Instagram');
    if (/\bfacebook\b/.test(combined)) return pick('Facebook');
    if (/\b(tiktok|tik\s*tok)\b/.test(combined)) return pick('TikTok');
    if (/\bbigo\b/.test(combined)) return pick('Bigo Live');
    if (/\b(telegram|tg|akkaunt)\b/.test(combined) || /@\w+/.test(suspectText)) {
      return pick('Telegram');
    }

    return '';
  }

  private flattenSuspectTree(nodes?: SuspectTreeNode[] | null): string {
    if (!Array.isArray(nodes) || nodes.length === 0) return '';
    const parts: string[] = [];
    const walk = (list: SuspectTreeNode[]) => {
      for (const n of list) {
        if (n.label) parts.push(n.label);
        if (n.value) parts.push(n.value);
        if (Array.isArray(n.children) && n.children.length > 0) {
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return parts.join(' ');
  }

  private calculateTotalLoss(app: Application, extraTransfers: Transfer[]): number {
    const seenIds = new Set<string>();
    let sum = 0;

    const addTransfer = (
      t?: { id?: string | null; amount?: number | string | null; currency?: string | null } | null,
    ) => {
      if (!t) return;
      if (t.id) {
        if (seenIds.has(t.id)) return;
        seenIds.add(t.id);
      }
      if (t.currency && t.currency.toUpperCase() !== 'UZS') return;
      const amt = Number(t.amount);
      if (!Number.isNaN(amt) && amt > 0) {
        sum += amt;
      }
    };

    addTransfer(app.transfer);
    if (Array.isArray(app.custom_fields)) {
      for (const cf of app.custom_fields) {
        addTransfer(cf.transfer);
      }
    }
    for (const et of extraTransfers) {
      addTransfer(et);
    }
    if (Array.isArray(app.damages)) {
      for (const dmg of app.damages) {
        if (dmg.currency && dmg.currency.toUpperCase() !== 'UZS') continue;
        const amt = Number(dmg.amount);
        if (!Number.isNaN(amt) && amt > 0) {
          sum += amt;
        }
      }
    }

    return Math.round(sum);
  }

  /**
   * Kirill va Lotin yozuvlarini yagona tekis ASCII qidiruv satriga o'tkazish
   */
  private toAscii(input: string): string {
    if (!input) return '';
    const cyrMap: Record<string, string> = {
      а: 'a',
      б: 'b',
      в: 'v',
      г: 'g',
      ғ: 'g',
      д: 'd',
      е: 'e',
      ё: 'yo',
      ж: 'j',
      з: 'z',
      и: 'i',
      й: 'y',
      к: 'k',
      қ: 'q',
      л: 'l',
      м: 'm',
      н: 'n',
      о: 'o',
      ў: 'o',
      п: 'p',
      р: 'r',
      с: 's',
      т: 't',
      у: 'u',
      ф: 'f',
      х: 'x',
      ҳ: 'h',
      ц: 'ts',
      ч: 'ch',
      ш: 'sh',
      щ: 'sh',
      ъ: '',
      ы: 'i',
      ь: '',
      э: 'e',
      ю: 'yu',
      я: 'ya',
    };

    const lower = input
      .toLowerCase()
      .replace(/[ʻʼ‘’`´']/g, '')
      .replace(/o‘|oʼ|o`/g, 'o')
      .replace(/g‘|gʼ|g`/g, 'g');

    let out = '';
    for (const ch of lower) {
      out += cyrMap[ch] !== undefined ? cyrMap[ch] : ch;
    }

    return out.replace(/\s+/g, ' ').trim();
  }

  /**
   * O'zbek tili imlo variantlari (a/o, h/x, q/k, bo'shliqlar) uchun fonetik kalit
   */
  private toPhoneticKey(ascii: string): string {
    return ascii
      .replace(/[^a-z0-9]/g, '')
      .replace(/x/g, 'h')
      .replace(/o/g, 'a');
  }
}
