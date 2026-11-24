import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(base64, 'base64');
}

export function getOnlyOfficeJwtSecret(configService: ConfigService): string {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  const secret = configService.get<string>('ONLYOFFICE_JWT_SECRET');
  if (isProduction && (!secret || secret.length < 24)) {
    throw new Error(
      'XAVFSIZLIK XATOLIGI: Production muhitida ONLYOFFICE_JWT_SECRET kamida 24 belgilik maxfiy kalit bo‘lishi shart!',
    );
  }
  return secret || 'uvd_onlyoffice_dev_secret_key_2026';
}

export function signOnlyOfficeJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = 3600,
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload: Record<string, unknown> = {
    ...payload,
    iat: typeof payload.iat === 'number' ? payload.iat : nowSec,
    exp: typeof payload.exp === 'number' ? payload.exp : nowSec + ttlSeconds,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${base64UrlEncode(signature)}`;
}

export function verifyOnlyOfficeJwtToken(token: string, secret: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedException('Yaroqsiz ONLYOFFICE JWT token');
  }

  const [headerB64, payloadB64, sigB64] = parts;

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedException('Yaroqsiz ONLYOFFICE JWT sarlavhasi');
  }

  if (header.alg !== 'HS256') {
    throw new UnauthorizedException('Ruxsat etilmagan ONLYOFFICE JWT algoritmi');
  }

  const expectedSig = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  const actualSig = base64UrlDecode(sigB64);

  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    throw new UnauthorizedException('ONLYOFFICE JWT imzosi noto‘g‘ri');
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedException('Yaroqsiz ONLYOFFICE JWT ma’lumoti');
  }

  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException('ONLYOFFICE JWT muddati tugagan');
  }

  return payload;
}

export function verifyOnlyOfficeCallbackRequest(
  req: Request,
  body: Record<string, unknown> | undefined,
  secret: string,
): Record<string, unknown> {
  const authHeader = req.headers.authorization;
  let token: string | null = null;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof body?.token === 'string') {
    token = body.token;
  }

  if (!token) {
    throw new UnauthorizedException('ONLYOFFICE callback autentifikatsiya tokeni topilmadi');
  }

  const decoded = verifyOnlyOfficeJwtToken(token, secret);
  // ONLYOFFICE payload ni 'payload' kaliti ichida yoki to'g'ridan-to'g'ri yuborishi mumkin
  if (decoded.payload && typeof decoded.payload === 'object') {
    return decoded.payload as Record<string, unknown>;
  }
  return decoded;
}

/**
 * SSRF himoyasi: faqat ichki ishonchli ONLYOFFICE konteyner hostiga ruxsat beriladi.
 * Tashqi yoki foydalanuvchi ko'rsatgan hostga hech qachon so'rov yuborilmaydi.
 */
export function buildSafeOnlyOfficeInternalUrl(
  rawDownloadUrl: string,
  internalBaseUrl: string,
): string {
  const parsed = new URL(rawDownloadUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnauthorizedException('Ruxsat etilmagan protokol');
  }

  const base = new URL(internalBaseUrl);
  const safePath = parsed.pathname.startsWith('/') ? parsed.pathname : `/${parsed.pathname}`;
  return `${base.origin}${safePath}${parsed.search}`;
}

export async function fetchSafeOnlyOfficeFile(
  rawDownloadUrl: string,
  internalBaseUrl: string,
  maxBytes = 30 * 1024 * 1024,
): Promise<Buffer> {
  const targetUrl = buildSafeOnlyOfficeInternalUrl(rawDownloadUrl, internalBaseUrl);
  const response = await fetch(targetUrl, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Faylni yuklab olishda xatolik: HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`ONLYOFFICE fayl hajmi ruxsat etilgan limitdan oshdi (${maxBytes} bayt)`);
  }

  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(`ONLYOFFICE fayl hajmi ruxsat etilgan limitdan oshdi (${maxBytes} bayt)`);
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`ONLYOFFICE fayl hajmi ruxsat etilgan limitdan oshdi (${maxBytes} bayt)`);
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

export function createSignedFileAccessQuery(
  resourceType: 'doc' | 'tpl',
  id: string,
  secret: string,
  ttlSeconds = 3600,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac('sha256', secret).update(`${resourceType}:${id}:${exp}`).digest('hex');
  return `exp=${exp}&sig=${sig}`;
}

export function verifySignedFileAccessQuery(
  resourceType: 'doc' | 'tpl',
  id: string,
  expStr: string | undefined,
  sig: string | undefined,
  secret: string,
): boolean {
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(`${resourceType}:${id}:${exp}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(sig, 'utf8');
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}
