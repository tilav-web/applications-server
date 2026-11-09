import { Injectable, Logger } from '@nestjs/common';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

@Injectable()
export class DocxEngineService {
  private readonly logger = new Logger(DocxEngineService.name);

  private createDocxParser(tag: string) {
    return {
      get: (scope: any) => {
        if (!scope) return '';
        if (tag === '.') return scope;
        // 1. Agar to'g'ridan-to'g'ri kalit mavjud bo'lsa (flat key)
        if (scope[tag] !== undefined && scope[tag] !== null) {
          return scope[tag];
        }
        // 2. Nuqta orqali bog'langan yo'l bo'lsa (nested property path, masalan: citizen.district.name)
        const parts = tag.split('.');
        let val = scope;
        for (const part of parts) {
          if (val === null || val === undefined) return '';
          val = val[part];
        }
        return val !== undefined && val !== null ? val : '';
      },
    };
  }

  /**
   * Shablon buferiga berilgan context ma'lumotlarini kiritib yangi Docx buferini qaytarish
   */
  renderTemplate(templateBuffer: Buffer, contextData: Record<string, any>): Buffer {
    try {
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        delimiters: { start: '{{', end: '}}' },
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => '', // Agar tag qiymati bo'lmasa, 'undefined' o'rniga bo'sh joy qoldiradi
        parser: (tag) => this.createDocxParser(tag),
      });

      doc.render(contextData);

      const generatedBuffer = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });

      return generatedBuffer;
    } catch (error: any) {
      this.logger.error('Docxtemplater rendering error:', error);
      if (error.properties && error.properties.errors) {
        const errorMessages = error.properties.errors
          .map((e: any) => e.message || e.explanation)
          .join('; ');
        throw new Error(`Shablonni to‘ldirishda xatolik: ${errorMessages}`);
      }
      throw new Error(`Shablonni to‘ldirishda xatolik: ${error.message || error}`);
    }
  }

  /**
   * Word fayli ichidagi barcha {{...}} teglarni aniqlash
   */
  extractTags(templateBuffer: Buffer): string[] {
    try {
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        delimiters: { start: '{{', end: '}}' },
        paragraphLoop: true,
        linebreaks: true,
      });

      // Word XML matnidan barcha teglarni regex orqali ajratib olamiz
      const content = zip.file('word/document.xml')?.asText() || '';
      const tagRegex = /\{\{([^{}]+)\}\}/g;
      const foundTags = new Set<string>();
      let match: RegExpExecArray | null;

      while ((match = tagRegex.exec(content)) !== null) {
        const tag = match[1].trim().replace(/^[#/^]/, ''); // #transfers yoki /transfers bo'lsa tozalash
        if (tag) {
          foundTags.add(tag);
        }
      }

      return Array.from(foundTags);
    } catch (e: any) {
      this.logger.warn(`extractTags ogohlantirish: ${e.message}`);
      return [];
    }
  }

  /**
   * Shablon sintaksisi to'g'riligini tekshirish (Validation)
   */
  validateTemplate(templateBuffer: Buffer): {
    valid: boolean;
    errors: string[];
    tags: string[];
  } {
    const errors: string[] = [];
    let tags: string[] = [];

    try {
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        delimiters: { start: '{{', end: '}}' },
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => '',
        parser: (tag) => this.createDocxParser(tag),
      });

      // Bo'sh mock data bilan tekshirib ko'ramiz
      doc.render({});
      tags = this.extractTags(templateBuffer);

      return {
        valid: true,
        errors: [],
        tags,
      };
    } catch (err: any) {
      if (err.properties && err.properties.errors) {
        for (const e of err.properties.errors) {
          errors.push(e.message || e.explanation || 'Noma’lum sintaktik xatolik');
        }
      } else {
        errors.push(err.message || 'Shablon faylini o‘qishda xatolik');
      }

      return {
        valid: false,
        errors,
        tags,
      };
    }
  }
}
