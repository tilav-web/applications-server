import { ArgumentsHost, Catch, HttpException, Injectable } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';

import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { AuditService } from './audit.service';

interface AuditedRequest extends Request {
  user?: JwtAccessPayload;
  __auditLogged?: boolean;
}

/**
 * Guard darajasida (JwtAuthGuard, RolesGuard, AppThrottlerGuard) tashlangan
 * 401 / 403 / 429 xavfsizlik xatolarini auditga yozuvchi global ExceptionFilter.
 * NestJS da Guard xatolari Interceptor ga yetib bormagani uchun bu qatlam shart.
 */
@Catch()
@Injectable()
export class SecurityExceptionFilter extends BaseExceptionFilter {
  constructor(
    httpAdapterHost: HttpAdapterHost,
    private readonly auditService: AuditService,
  ) {
    super(httpAdapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<AuditedRequest>();
      const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;

      if (!req.__auditLogged && (statusCode === 401 || statusCode === 403 || statusCode === 429)) {
        req.__auditLogged = true;
        const method = req.method?.toUpperCase() || 'GET';
        const rawPath = req.path || req.originalUrl?.split('?')[0] || '/';
        const ip = (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
        const userAgent =
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

        void this.auditService.recordTraffic(ip, method, rawPath, statusCode);

        const bodyUsername =
          req.body && typeof (req.body as Record<string, unknown>).username === 'string'
            ? ((req.body as Record<string, unknown>).username as string)
            : null;
        const username = req.user?.username ?? bodyUsername;

        const message = exception instanceof HttpException ? exception.message : 'Ruxsatsiz so‘rov';

        void this.auditService.log({
          user_id: req.user?.sub ?? null,
          username,
          role: req.user?.role ?? null,
          action: statusCode === 429 ? 'RATE_LIMIT_BLOCKED' : 'ACCESS_DENIED',
          entity_type: rawPath.startsWith('/auth') ? 'auth' : 'security',
          entity_id: null,
          summary:
            statusCode === 429
              ? `So‘rovlar limiti oshib ketdi (${rawPath})`
              : `Ruxsatsiz kirish urinishi (${statusCode}: ${method} ${rawPath})`,
          details: { error: message },
          method,
          path: rawPath,
          ip,
          user_agent: userAgent,
          status_code: statusCode,
          is_success: false,
          severity: statusCode === 403 ? 'CRITICAL' : 'WARNING',
          duration_ms: 0,
        });
      }
    }

    super.catch(exception, host);
  }
}
