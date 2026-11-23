import { Injectable, Logger } from '@nestjs/common';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

interface DocxtemplaterSubError {
  message?: string;
  explanation?: string;
}

interface DocxtemplaterError {
  message?: string;
  properties?: {
    errors?: DocxtemplaterSubError[];
  };
}

@Injectable()
export class DocxEngineService {
  private readonly logger = new Logger(DocxEngineService.name);

  private createDocxParser(tag: string) {
    return {
      get: (scope: Record<string, unknown> | null | undefined): unknown => {
        if (!scope) return '';
        if (tag === '.') return scope;
        // 1. Agar to'g'ridan-to'g'ri kalit mavjud bo'lsa (flat key)
        if (scope[tag] !== undefined && scope[tag] !== null) {
          return scope[tag];
        }
        // 2. Nuqta orqali bog'langan yo'l bo'lsa (nested property path, masalan: citizen.district.name)
        const parts = tag.split('.');
        let val: unknown = scope;
        for (const part of parts) {
          if (val === null || val === undefined || typeof val !== 'object') return '';
          val = (val as Record<string, unknown>)[part];
        }
        return val !== undefined && val !== null ? val : '';
      },
    };
  }

  /**
   * Shablon buferiga berilgan context ma'lumotlarini kiritib yangi Docx buferini qaytarish
   */
  renderTemplate(templateBuffer: Buffer, contextData: Record<string, unknown>): Buffer {
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
    } catch (error: unknown) {
      this.logger.error('Docxtemplater rendering error:', error);
      const docxErr = error as DocxtemplaterError;
      if (docxErr?.properties?.errors) {
        const errorMessages = docxErr.properties.errors
          .map((e) => e.message || e.explanation)
          .join('; ');
        throw new Error(`Shablonni to‘ldirishda xatolik: ${errorMessages}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Shablonni to‘ldirishda xatolik: ${message}`);
    }
  }

  /**
   * Word fayli ichidagi barcha {{...}} teglarni aniqlash
   */
  extractTags(templateBuffer: Buffer): string[] {
    try {
      const zip = new PizZip(templateBuffer);
      new Docxtemplater(zip, {
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`extractTags ogohlantirish: ${message}`);
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
    } catch (err: unknown) {
      const docxErr = err as DocxtemplaterError;
      if (docxErr?.properties?.errors) {
        for (const e of docxErr.properties.errors) {
          errors.push(e.message || e.explanation || 'Noma’lum sintaktik xatolik');
        }
      } else {
        const message = err instanceof Error ? err.message : undefined;
        errors.push(message || 'Shablon faylini o‘qishda xatolik');
      }

      return {
        valid: false,
        errors,
        tags,
      };
    }
  }
}
