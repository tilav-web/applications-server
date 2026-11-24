import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { RedisService } from '../redis/redis.service';
import type { User } from '../users/user.entity';
import type { Auth } from './auth.entity';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let redisMap: Map<string, string>;
  let jwtService: { verifyAsync: jest.Mock; signAsync: jest.Mock };
  let configValues: Record<string, string>;

  beforeEach(() => {
    redisMap = new Map<string, string>();
    configValues = {
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'dev_access_secret_key_for_unit_tests_123456',
      JWT_REFRESH_SECRET: 'dev_refresh_secret_key_for_unit_tests_123456',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    };

    jwtService = {
      verifyAsync: jest.fn(),
      signAsync: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
    } as unknown as ConfigService;

    const redisService = {
      get: jest.fn((k: string) => Promise.resolve(redisMap.get(k) ?? null)),
      set: jest.fn((k: string, v: string) => {
        redisMap.set(k, v);
        return Promise.resolve('OK' as const);
      }),
      del: jest.fn((k: string) => {
        redisMap.delete(k);
        return Promise.resolve(1);
      }),
    } as unknown as RedisService;

    service = new AuthService(
      { findOne: jest.fn(), update: jest.fn() } as unknown as Repository<Auth>,
      { findOne: jest.fn() } as unknown as Repository<User>,
      jwtService as unknown as JwtService,
      configService,
      redisService,
    );
  });

  it('revokes tokens issued before revokeUserTokens timestamp and clears profile cache', async () => {
    const authId = 'auth-user-1';
    redisMap.set(`user:profile:${authId}`, '{"cached":true}');

    const issuedBefore = Date.now() - 5000;
    await service.revokeUserTokens(authId);

    expect(redisMap.has(`user:profile:${authId}`)).toBe(false);
    expect(await service.isTokenRevoked(authId, issuedBefore)).toBe(true);
    expect(await service.isTokenRevoked(authId, Date.now() + 5000)).toBe(false);
  });

  it('rejects expired or revoked tokens in verifyActiveAccessRequest', async () => {
    jwtService.verifyAsync.mockRejectedValueOnce(new Error('jwt expired'));
    const expiredReq = {
      headers: { authorization: 'Bearer expired.jwt.token' },
      cookies: {},
    } as unknown as Request;
    expect(await service.verifyActiveAccessRequest(expiredReq)).toBeNull();

    const authId = 'auth-user-2';
    await service.revokeUserTokens(authId);
    jwtService.verifyAsync.mockResolvedValueOnce({
      sub: authId,
      username: 'officer',
      role: Role.DISTRICT_OFFICER,
      is_root: false,
      issued_at_ms: Date.now() - 10_000,
    });
    const revokedReq = {
      headers: { authorization: 'Bearer valid.but.revoked' },
      cookies: {},
    } as unknown as Request;
    expect(await service.verifyActiveAccessRequest(revokedReq)).toBeNull();

    jwtService.verifyAsync.mockResolvedValueOnce({
      sub: authId,
      username: 'officer',
      role: Role.DISTRICT_OFFICER,
      is_root: false,
      issued_at_ms: Date.now() + 10_000,
    });
    const activeReq = {
      headers: { authorization: 'Bearer valid.active.token' },
      cookies: {},
    } as unknown as Request;
    const verified = await service.verifyActiveAccessRequest(activeReq);
    expect(verified?.sub).toBe(authId);
    expect(verified?.role).toBe(Role.DISTRICT_OFFICER);
  });

  it('rejects weak JWT secrets on production bootstrap', async () => {
    configValues.NODE_ENV = 'production';
    configValues.JWT_ACCESS_SECRET = 'short';

    await expect(service.onApplicationBootstrap()).rejects.toThrow(/JWT_ACCESS_SECRET/);
  });
});
