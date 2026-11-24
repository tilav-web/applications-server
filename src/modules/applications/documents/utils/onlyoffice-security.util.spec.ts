import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import {
  buildSafeOnlyOfficeInternalUrl,
  createSignedFileAccessQuery,
  signOnlyOfficeJwt,
  verifyOnlyOfficeCallbackRequest,
  verifyOnlyOfficeJwtToken,
  verifySignedFileAccessQuery,
} from './onlyoffice-security.util';

describe('onlyoffice-security.util', () => {
  const secret = 'test_onlyoffice_secret_key_min_24_chars';

  it('signs and verifies valid HS256 JWT tokens with iat/exp', () => {
    const token = signOnlyOfficeJwt({ docId: 'doc-1' }, secret, 600);
    const payload = verifyOnlyOfficeJwtToken(token, secret);
    expect(payload.docId).toBe('doc-1');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('rejects expired JWT tokens', () => {
    const expired = signOnlyOfficeJwt(
      { docId: 'doc-1', exp: Math.floor(Date.now() / 1000) - 60 },
      secret,
    );
    expect(() => verifyOnlyOfficeJwtToken(expired, secret)).toThrow(UnauthorizedException);
  });

  it('rejects alg=none or tampered signatures', () => {
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify({ status: 2 })).toString('base64url');
    expect(() => verifyOnlyOfficeJwtToken(`${noneHeader}.${body}.`, secret)).toThrow(
      UnauthorizedException,
    );

    const valid = signOnlyOfficeJwt({ status: 2 }, secret);
    expect(() => verifyOnlyOfficeJwtToken(valid, 'wrong_secret')).toThrow(UnauthorizedException);
  });

  it('rejects unsigned callback requests without Bearer or body.token', () => {
    const fakeReq = { headers: {} } as unknown as Request;
    expect(() => verifyOnlyOfficeCallbackRequest(fakeReq, { status: 2 }, secret)).toThrow(
      UnauthorizedException,
    );

    const validToken = signOnlyOfficeJwt({ payload: { status: 2, key: 'k-1' } }, secret);
    const verified = verifyOnlyOfficeCallbackRequest(
      { headers: { authorization: `Bearer ${validToken}` } } as unknown as Request,
      { status: 2 },
      secret,
    );
    expect(verified).toEqual({ status: 2, key: 'k-1' });
  });

  it('prevents SSRF by pinning download URL origin to internal ONLYOFFICE base', () => {
    const safeUrl = buildSafeOnlyOfficeInternalUrl(
      'http://169.254.169.254/cache/files/abc/output.docx?token=1',
      'http://onlyoffice:80',
    );
    expect(safeUrl).toBe('http://onlyoffice/cache/files/abc/output.docx?token=1');

    expect(() =>
      buildSafeOnlyOfficeInternalUrl('file:///etc/passwd', 'http://onlyoffice:80'),
    ).toThrow(UnauthorizedException);
  });

  it('validates signed file access query parameters and rejects tampered/expired ones', () => {
    const qs = createSignedFileAccessQuery('doc', 'uuid-123', secret, 300);
    const params = new URLSearchParams(qs);
    expect(
      verifySignedFileAccessQuery(
        'doc',
        'uuid-123',
        params.get('exp') || undefined,
        params.get('sig') || undefined,
        secret,
      ),
    ).toBe(true);
    expect(
      verifySignedFileAccessQuery(
        'doc',
        'uuid-other',
        params.get('exp') || undefined,
        params.get('sig') || undefined,
        secret,
      ),
    ).toBe(false);
    expect(
      verifySignedFileAccessQuery(
        'doc',
        'uuid-123',
        '1000',
        params.get('sig') || undefined,
        secret,
      ),
    ).toBe(false);
  });
});
