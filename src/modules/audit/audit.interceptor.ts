import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { AuditService } from './audit.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isSensitiveReadPath(path: string): boolean {
  return (
    path.includes('/export') ||
    path.includes('/dossier/') ||
    path.includes('/files/download') ||
    /\/documents\/[^/]+\/file/.test(path)
  );
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request & { user?: JwtAccessPayload }>();
    const res = context.switchToHttp().getResponse<Response>();

    const method = req.method?.toUpperCase() || 'GET';
    const rawPath = req.path || req.originalUrl?.split('?')[0] || '/';

    const shouldAudit = MUTATING_METHODS.has(method) || isSensitiveReadPath(rawPath);
    if (!shouldAudit) {
      return next.handle();
    }

    const startedAt = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || null;
    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

    return next.handle().pipe(
      tap({
        next: () => {
          void this.auditService.log({
            user_id: req.user?.sub ?? null,
            username: req.user?.username ?? null,
            role: req.user?.role ?? null,
            method,
            path: rawPath,
            ip,
            user_agent: userAgent,
            status_code: res.statusCode || 200,
            duration_ms: Date.now() - startedAt,
          });
        },
        error: (err: { status?: number; getStatus?: () => number }) => {
          const statusCode =
            typeof err?.getStatus === 'function' ? err.getStatus() : err?.status || 500;
          void this.auditService.log({
            user_id: req.user?.sub ?? null,
            username: req.user?.username ?? null,
            role: req.user?.role ?? null,
            method,
            path: rawPath,
            ip,
            user_agent: userAgent,
            status_code: statusCode,
            duration_ms: Date.now() - startedAt,
          });
        },
      }),
    );
  }
}
