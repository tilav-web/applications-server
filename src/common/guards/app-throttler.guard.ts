import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';

import type { JwtAccessPayload } from '../types/jwt-payload.interface';

interface RequestWithUser extends Request {
  user?: {
    sub?: string;
    id?: string;
  };
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as RequestWithUser;

    // 1. Agar foydalanuvchi allaqachon aniqlangan bo'lsa
    if (request.user?.sub || request.user?.id) {
      return `user_${request.user.sub || request.user.id}`;
    }

    // 2. Global guard JwtAuthGuard dan oldin ishlagani uchun, Bearer/cookie JWT imzosini
    // yengil tekshirib ofis NAT IP ortidagi xodimlarga alohida kvota ajratamiz
    const authHeader = request.headers?.authorization;
    const cookies = request.cookies as Record<string, string> | undefined;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : cookies?.['access_token'];

    if (token) {
      try {
        const secret = this.configService.get<string>(
          'JWT_ACCESS_SECRET',
          'uvd_access_token_secret_key_2026',
        );
        const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, { secret });
        if (payload?.sub) {
          return `user_${payload.sub}`;
        }
      } catch {
        // Yaroqsiz yoki muddati o'tgan token — IP bo'yicha hisoblaymiz
      }
    }

    // Express 'trust proxy' (1 hop - Nginx) orqali hisoblangan ishonchli client IP.
    // X-Forwarded-For / X-Real-IP sarlavhalariga to'g'ridan-to'g'ri ishonilmaydi (IP spoofing oldini olish).
    const ip = request.ip || request.socket?.remoteAddress || '127.0.0.1';
    return ip;
  }

  protected override async getErrorMessage(
    context: ExecutionContext,
    _throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<string> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.path?.includes('/auth/login')) {
      return Promise.resolve(
        'Xavfsizlik nuqtai nazaridan kirish vaqtincha cheklandi (login urinishlari limiti oshdi). Iltimos, 1 daqiqadan so‘ng qayta urinib ko‘ring.',
      );
    }

    return Promise.resolve(
      'Ko‘p marotaba so‘rov yuborildi. Iltimos, birozdan so‘ng qayta urinib ko‘ring.',
    );
  }
}
