import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';

import type { AuthService } from '../../modules/auth/auth.service';
import { Role } from '../enums/role.enum';
import { JwtAuthGuard } from './jwt-auth.guard';

function createMockContext(request: Record<string, unknown>, response: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const verifyAsync = jest.fn();
  const getAccessSecret = jest.fn().mockReturnValue('secret');
  const isTokenRevoked = jest.fn();
  const refreshTokens = jest.fn();

  const jwtService = { verifyAsync } as unknown as JwtService;
  const authService = {
    getAccessSecret,
    isTokenRevoked,
    refreshTokens,
  } as unknown as AuthService;

  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(jwtService, authService);
  });

  it('blocks revoked access tokens with UnauthorizedException', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'auth-1',
      username: 'admin',
      role: Role.ADMIN,
      is_root: false,
      iat: 1000,
    });
    isTokenRevoked.mockResolvedValue(true);

    const req = { headers: { authorization: 'Bearer valid_but_revoked' }, cookies: {} };
    const res = { setHeader: jest.fn() };

    await expect(guard.canActivate(createMockContext(req, res))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it('propagates is_root during silent cookie refresh', async () => {
    verifyAsync.mockRejectedValue(new Error('jwt expired'));
    refreshTokens.mockResolvedValue({
      accessToken: 'new-access-token',
      auth: {
        id: 'root-1',
        username: 'rootadmin',
        role: Role.SUPER_ADMIN,
        is_root: true,
      },
    });

    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer expired' },
      cookies: { refresh_token: 'valid-refresh' },
    };
    const res = { setHeader: jest.fn() };

    const result = await guard.canActivate(createMockContext(req, res));
    expect(result).toBe(true);
    expect(req.user).toEqual({
      sub: 'root-1',
      username: 'rootadmin',
      role: Role.SUPER_ADMIN,
      is_root: true,
    });
    expect(res.setHeader).toHaveBeenCalledWith('x-new-access-token', 'new-access-token');
  });

  it('rejects requests without access or refresh tokens', async () => {
    const req = { headers: {}, cookies: {} };
    const res = { setHeader: jest.fn() };
    await expect(guard.canActivate(createMockContext(req, res))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
