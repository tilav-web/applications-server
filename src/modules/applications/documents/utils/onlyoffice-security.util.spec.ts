import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import {
  buildSafeOnlyOfficeInternalUrl,
  createSignedFileAccessQuery,
  fetchSafeOnlyOfficeFile,
  getOnlyOfficeJwtSecret,
  signOnlyOfficeJwt,
  verifyOnlyOfficeCallbackRequest,
  verifyOnlyOfficeJwtToken,
  verifySignedFileAccessQuery,
} from './onlyoffice-security.util';

const SECRET = 'super_secret_onlyoffice_key_1234567890';

function makeConfigService(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('onlyoffice-security.util', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getOnlyOfficeJwtSecret', () => {
    it('throws in production when secret is missing or shorter than 24 characters', () => {
      expect(() => getOnlyOfficeJwtSecret(makeConfigService({ NODE_ENV: 'production' }))).toThrow(
        /ONLYOFFICE_JWT_SECRET/,
      );

      expect(() =>
        getOnlyOfficeJwtSecret(
          makeConfigService({ NODE_ENV: 'production', ONLYOFFICE_JWT_SECRET: 'short_secret' }),
        ),
      ).toThrow(/24/);
    });

    it('accepts a strong secret in production and falls back to dev secret outside production', () => {
      expect(
        getOnlyOfficeJwtSecret(
          makeConfigService({ NODE_ENV: 'production', ONLYOFFICE_JWT_SECRET: SECRET }),
        ),
      ).toBe(SECRET);

      expect(getOnlyOfficeJwtSecret(makeConfigService({ NODE_ENV: 'development' }))).toBe(
        'uvd_onlyoffice_dev_secret_key_2026',
      );
    });
  });

  describe('signOnlyOfficeJwt & verifyOnlyOfficeJwtToken', () => {
    it('signs and verifies HS256 payload', () => {
      const token = signOnlyOfficeJwt({ status: 2, key: 'doc_1' }, SECRET, 60);
      const decoded = verifyOnlyOfficeJwtToken(token, SECRET);

      expect(decoded.status).toBe(2);
      expect(decoded.key).toBe('doc_1');
      expect(typeof decoded.exp).toBe('number');
    });

    it('rejects malformed tokens, wrong secret, tampered payload, alg:none, and expired tokens', () => {
      const valid = signOnlyOfficeJwt({ status: 2 }, SECRET, 60);
      const [h, p, s] = valid.split('.');

      expect(() => verifyOnlyOfficeJwtToken('not-a-jwt', SECRET)).toThrow(UnauthorizedException);
      expect(() => verifyOnlyOfficeJwtToken(valid, 'wrong_secret_key_000000000000')).toThrow(
        UnauthorizedException,
      );

      // Tampered payload
      const tamperedPayload = Buffer.from(JSON.stringify({ status: 6 })).toString('base64url');
      expect(() => verifyOnlyOfficeJwtToken(`${h}.${tamperedPayload}.${s}`, SECRET)).toThrow(
        UnauthorizedException,
      );

      // Algorithm confusion (alg: none)
      const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );
      expect(() => verifyOnlyOfficeJwtToken(`${noneHeader}.${p}.${s}`, SECRET)).toThrow(
        UnauthorizedException,
      );

      // Expired token
      const expired = signOnlyOfficeJwt(
        { status: 2, exp: Math.floor(Date.now() / 1000) - 10 },
        SECRET,
      );
      expect(() => verifyOnlyOfficeJwtToken(expired, SECRET)).toThrow(UnauthorizedException);
    });
  });

  describe('verifyOnlyOfficeCallbackRequest', () => {
    it('extracts and verifies Bearer token from Authorization header and unwraps nested payload', () => {
      const token = signOnlyOfficeJwt(
        { payload: { status: 2, key: 'doc_1', url: 'http://onlyoffice/file.docx' } },
        SECRET,
      );
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;

      const payload = verifyOnlyOfficeCallbackRequest(req, { status: 999 }, SECRET);
      expect(payload).toEqual({
        status: 2,
        key: 'doc_1',
        url: 'http://onlyoffice/file.docx',
      });
    });

    it('supports body.token when Authorization header is absent and rejects unsigned callbacks', () => {
      const token = signOnlyOfficeJwt({ status: 6, key: 'doc_2' }, SECRET);
      const req = { headers: {} } as unknown as Request;

      expect(verifyOnlyOfficeCallbackRequest(req, { token, status: 999 }, SECRET)).toMatchObject({
        status: 6,
        key: 'doc_2',
      });

      expect(() => verifyOnlyOfficeCallbackRequest(req, { status: 2 }, SECRET)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('buildSafeOnlyOfficeInternalUrl & fetchSafeOnlyOfficeFile (SSRF + size cap)', () => {
    it('rewrites attacker host to trusted internal ONLYOFFICE origin and rejects non-HTTP protocols', () => {
      const safeUrl = buildSafeOnlyOfficeInternalUrl(
        'https://evil.attacker.com:8443/cache/files/data/doc.docx?md5=abc',
        'http://uvd_app_onlyoffice:80',
      );
      expect(safeUrl).toBe('http://uvd_app_onlyoffice/cache/files/data/doc.docx?md5=abc');

      expect(() =>
        buildSafeOnlyOfficeInternalUrl('file:///etc/passwd', 'http://uvd_app_onlyoffice'),
      ).toThrow(UnauthorizedException);
    });

    it('rejects responses whose content-length or streamed body exceeds maxBytes', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '1024' }),
        body: null,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      } as unknown as Response);

      await expect(
        fetchSafeOnlyOfficeFile(
          'http://evil.local/cache/file.docx',
          'http://uvd_app_onlyoffice',
          512,
        ),
      ).rejects.toThrow(/limitdan oshdi/);

      // Stream exceeds maxBytes even without content-length header
      const cancel = jest.fn().mockResolvedValue(undefined);
      let readCount = 0;
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: () => {
              readCount += 1;
              if (readCount === 1) {
                return Promise.resolve({ done: false, value: new Uint8Array(400) });
              }
              return Promise.resolve({ done: false, value: new Uint8Array(400) });
            },
            cancel,
          }),
        },
      } as unknown as Response);

      await expect(
        fetchSafeOnlyOfficeFile(
          'http://evil.local/cache/file.docx',
          'http://uvd_app_onlyoffice',
          512,
        ),
      ).rejects.toThrow(/limitdan oshdi/);
      expect(cancel).toHaveBeenCalled();
    });
  });

  describe('createSignedFileAccessQuery & verifySignedFileAccessQuery', () => {
    it('verifies valid signature and rejects wrong resourceType, id, secret, or expired query', () => {
      const qs = createSignedFileAccessQuery('doc', 'doc-123', SECRET, 300);
      const params = new URLSearchParams(qs);
      const exp = params.get('exp') ?? undefined;
      const sig = params.get('sig') ?? undefined;

      expect(verifySignedFileAccessQuery('doc', 'doc-123', exp, sig, SECRET)).toBe(true);
      expect(verifySignedFileAccessQuery('tpl', 'doc-123', exp, sig, SECRET)).toBe(false);
      expect(verifySignedFileAccessQuery('doc', 'doc-999', exp, sig, SECRET)).toBe(false);
      expect(verifySignedFileAccessQuery('doc', 'doc-123', exp, sig, 'other-secret')).toBe(false);

      const expiredQs = createSignedFileAccessQuery('doc', 'doc-123', SECRET, -10);
      const expiredParams = new URLSearchParams(expiredQs);
      expect(
        verifySignedFileAccessQuery(
          'doc',
          'doc-123',
          expiredParams.get('exp') ?? undefined,
          expiredParams.get('sig') ?? undefined,
          SECRET,
        ),
      ).toBe(false);
    });
  });
});
