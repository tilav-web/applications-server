import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import { AuthService } from '../../modules/auth/auth.service';
import type { JwtAccessPayload } from '../types/jwt-payload.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtAccessPayload }>();
    const response = context.switchToHttp().getResponse<Response>();

    const authHeader = request.headers.authorization;
    let accessToken: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
    }

    if (accessToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(accessToken, {
          secret: this.configService.get<string>(
            'JWT_ACCESS_SECRET',
            'uvd_access_token_secret_key_2026',
          ),
        });
        request.user = payload;
        return true;
      } catch {
        // Access token yaroqsiz yoki muddati o'tgan bo'lsa, cookie dagi refresh_token ni tekshiramiz
      }
    }

    const refreshToken = request.cookies?.['refresh_token'] as string | undefined;
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
      };

      response.setHeader('x-new-access-token', newAccessToken);

      return true;
    } catch {
      throw new UnauthorizedException('Sessiya muddati tugagan, iltimos qaytadan kiring');
    }
  }
}
