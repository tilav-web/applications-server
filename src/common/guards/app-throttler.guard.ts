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

    // Agar foydalanuvchi tizimga kirgan bo'lsa, har bir xodim alohida kvotaga ega bo'ladi
    if (request.user?.sub || request.user?.id) {
      return Promise.resolve(`user_${request.user.sub || request.user.id}`);
    }

    // Nginx proksi orqali kelayotgan haqiqiy client IP ni aniqlaymiz
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const clientIp = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
      if (clientIp) {
        return Promise.resolve(clientIp);
      }
    }

    const realIp = request.headers['x-real-ip'];
    if (typeof realIp === 'string') {
      return Promise.resolve(realIp);
    }

    return Promise.resolve(request.ip || '127.0.0.1');
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
