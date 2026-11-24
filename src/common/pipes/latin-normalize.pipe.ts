import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

import { cyrillicToLatinNormalized } from '../utils/uzbek-latin.util';

/**
 * Hech qachon krill -> lotin o'girilmasligi kerak bo'lgan maydon nomlari (lowercase).
 */
const EXCLUDED_KEYS = new Set([
  'password',
  'newpassword',
  'new_password',
  'oldpassword',
  'old_password',
  'currentpassword',
  'current_password',
  'confirmpassword',
  'confirm_password',
  'password_hash',
  'token',
  'bot_token',
  'telegram_bot_token',
  'accesstoken',
  'refreshtoken',
  'access_token',
  'refresh_token',
  'secret',
  'hash',
  'sig',
  'username',
  'email',
  'title_krill',
  'file_key_krill',
  'file_key',
  'key',
  'doc_key',
  'file_url',
  'url',
  'script',
  'mime_type',
  'mimetype',
  'path',
  'id',
  'uuid',
]);

const UPPERCASE_ID_KEYS = new Set(['passport', 'passport_series', 'passport_number']);

const SKIP_VALUE_PATTERNS = [
  /^https?:\/\//i,
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/,
];

function shouldSkipStringValue(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return true;
  return SKIP_VALUE_PATTERNS.some((re) => re.test(trimmed));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date || Buffer.isBuffer(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Global Pipe: barcha kiruvchi HTTP body, query va param qiymatlaridagi krill matnlarni
 * yagona Lotin alifbosiga va standart ASCII apostrof (`'`) ga normallashtiradi.
 *
 * ValidationPipe'dan OLDIN ro'yxatdan o'tkaziladi.
 */
@Injectable()
export class LatinNormalizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body' && metadata.type !== 'query' && metadata.type !== 'param') {
      return value;
    }

    return this.normalizeValue(value, metadata.data);
  }

  private normalizeValue(value: unknown, key?: string): unknown {
    const normalizedKey = key ? key.toLowerCase() : '';

    if (normalizedKey && EXCLUDED_KEYS.has(normalizedKey)) {
      return value;
    }

    if (typeof value === 'string') {
      if (shouldSkipStringValue(value)) {
        return value;
      }
      const converted = cyrillicToLatinNormalized(value);
      if (normalizedKey && UPPERCASE_ID_KEYS.has(normalizedKey)) {
        return converted.toUpperCase();
      }
      return converted;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item));
    }

    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.normalizeValue(v, k);
      }
      return result;
    }

    return value;
  }
}
