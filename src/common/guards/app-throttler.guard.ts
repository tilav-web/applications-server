import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';

interface RequestWithUser extends Request {
  user?: {
    sub?: string;
    id?: string;
  };
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as RequestWithUser;

    // Agar foydalanuvchi autentifikatsiyadan o'tgan bo'lsa, alohida kvota
    if (request.user?.sub || request.user?.id) {
      return Promise.resolve(`user_${request.user.sub || request.user.id}`);
    }

    // Express 'trust proxy' (1 hop - Nginx) orqali hisoblangan ishonchli client IP.
    // X-Forwarded-For / X-Real-IP sarlavhalariga to'g'ridan-to'g'ri ishonilmaydi (IP spoofing oldini olish).
    const ip = request.ip || request.socket?.remoteAddress || '127.0.0.1';
    return Promise.resolve(ip);
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
