import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import { AuthService } from '../../modules/auth/auth.service';
import type { JwtAccessPayload } from '../types/jwt-payload.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtAccessPayload }>();
    const response = context.switchToHttp().getResponse<Response>();

    const authHeader = request.headers.authorization;
    const cookies = request.cookies as Record<string, string> | undefined;
    let accessToken: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
    } else if (cookies?.['access_token']) {
      accessToken = cookies['access_token'];
    }

    if (accessToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(accessToken, {
          secret: this.authService.getAccessSecret(),
        });
        const revoked = await this.authService.isTokenRevoked(
          payload.sub,
          payload.issued_at_ms,
          payload.iat,
        );
        if (revoked) {
          throw new UnauthorizedException('Sessiya bekor qilingan, iltimos qaytadan kiring');
        }
        request.user = payload;
        return true;
      } catch (err) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
        // Access token yaroqsiz yoki muddati o'tgan bo'lsa, cookie dagi refresh_token ni tekshiramiz
      }
    }

    const refreshToken = cookies?.['refresh_token'];
    if (!refreshToken) {
      throw new UnauthorizedException(
        "Autentifikatsiyadan o'tilmagan yoki sessiya muddati tugagan",
      );
    }

    try {
      const { accessToken: newAccessToken, auth } = await this.authService.refreshTokens(
        refreshToken,
        response,
      );

      request.user = {
        sub: auth.id,
        username: auth.username,
        role: auth.role,
        is_root: Boolean(auth.is_root),
      };

      response.setHeader('x-new-access-token', newAccessToken);

      return true;
    } catch {
      throw new UnauthorizedException('Sessiya muddati tugagan, iltimos qaytadan kiring');
    }
  }
}
