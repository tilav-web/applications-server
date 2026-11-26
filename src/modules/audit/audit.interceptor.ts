import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import { AuditService } from './audit.service';
import type { AuditSeverity } from './audit-log.entity';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_KEYS = new Set([
  'password',
  'current_password',
  'new_password',
  'old_password',
  'confirm_password',
  'token',
  'bot_token',
  'telegram_bot_token',
  'access_token',
  'refresh_token',
  'secret',
  'hashed_refresh_token',
  'passport',
  'pinfl',
  'card_number',
  'receiver_card_number',
  'sender_card_number',
]);

function sanitizePayload(input: unknown, depth = 0): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 2) {
    return null;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(input as Record<string, unknown>).slice(0, 25);
  for (const [k, v] of entries) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizePayload(v, depth + 1);
    } else if (Array.isArray(v)) {
      out[k] = `[Array(${v.length})]`;
    } else if (typeof v === 'string' && v.length > 200) {
      out[k] = `${v.slice(0, 200)}...`;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function classifyAuditEvent(
  method: string,
  path: string,
  statusCode: number,
  username: string | null,
): {
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  severity: AuditSeverity;
  shouldAudit: boolean;
} {
  const isError = statusCode >= 400;
  const uuidMatch = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const entityId = uuidMatch ? uuidMatch[0] : null;

  // Auth hodisalari
  if (path.includes('/auth/login')) {
    return {
      action: isError ? 'LOGIN_FAILED' : 'LOGIN_SUCCESS',
      entity_type: 'auth',
      entity_id: null,
      summary: isError
        ? `Tizimga kirish muvaffaqiyatsiz (${username || 'noma’lum'})`
        : `Tizimga muvaffaqiyatli kirdi`,
      severity: isError ? 'WARNING' : 'INFO',
      shouldAudit: true,
    };
  }
  if (path.includes('/auth/logout')) {
    return {
      action: 'LOGOUT',
      entity_type: 'auth',
      entity_id: null,
      summary: 'Tizimdan chiqdi',
      severity: 'INFO',
      shouldAudit: true,
    };
  }
  if (path.includes('/auth/me') || path.includes('/auth/profile')) {
    if (MUTATING_METHODS.has(method)) {
      return {
        action: 'PROFILE_UPDATE',
        entity_type: 'auth',
        entity_id: null,
        summary: 'Shaxsiy profil / parol ma’lumotlarini yangiladi',
        severity: 'WARNING',
        shouldAudit: true,
      };
    }
  }

  // Bo'limni aniqlash
  let entityType: string | null = 'system';
  let entityLabelUz = 'Ma’lumot';
  if (path.startsWith('/applications')) {
    entityType = 'application';
    entityLabelUz = 'Ariza';
  } else if (path.startsWith('/citizens')) {
    entityType = 'citizen';
    entityLabelUz = 'Fuqaro';
  } else if (path.startsWith('/cards')) {
    entityType = 'card';
    entityLabelUz = 'Plastik karta';
  } else if (path.startsWith('/transfers')) {
    entityType = 'transfer';
    entityLabelUz = 'Pul o‘tkazmasi';
  } else if (path.startsWith('/users')) {
    entityType = 'user';
    entityLabelUz = 'Foydalanuvchi';
  } else if (path.startsWith('/documents')) {
    entityType = 'document';
    entityLabelUz = 'Rasmiy hujjat';
  } else if (path.startsWith('/templates')) {
    entityType = 'template';
    entityLabelUz = 'Shablon';
  } else if (path.startsWith('/files')) {
    entityType = 'file';
    entityLabelUz = 'Fayl';
  } else if (path.startsWith('/intelligence')) {
    entityType = 'intelligence';
    entityLabelUz = 'Dosye / Razvedka';
  } else if (path.startsWith('/audit')) {
    entityType = 'security';
    entityLabelUz = 'Audit / Xavfsizlik';
  } else if (
    path.startsWith('/districts') ||
    path.startsWith('/regions') ||
    path.startsWith('/neighborhoods') ||
    path.startsWith('/crimes') ||
    path.startsWith('/banks') ||
    path.startsWith('/payment-providers') ||
    path.startsWith('/application-statuses')
  ) {
    entityType = 'reference';
    entityLabelUz = 'Ma’lumotnoma';
  }

  // Eksportlar
  if (path.includes('/export')) {
    const isDocx = path.includes('docx');
    return {
      action: isDocx ? 'EXPORT_DOCX' : 'EXPORT_EXCEL',
      entity_type: entityType,
      entity_id: entityId,
      summary: `${entityLabelUz} ma’lumotlarini ${isDocx ? 'Word' : 'Excel'} ga eksport qildi`,
      severity: 'INFO',
      shouldAudit: true,
    };
  }

  // Dosye ko'rish / fayl yuklab olish
  if (path.includes('/dossier/') && method === 'GET') {
    return {
      action: 'VIEW_DOSSIER',
      entity_type: entityType,
      entity_id: entityId,
      summary: `360° Dosyeni ko‘rdi`,
      severity: 'INFO',
      shouldAudit: true,
    };
  }
  if (
    (path.includes('/files/download') || /\/documents\/[^/]+\/file/.test(path)) &&
    method === 'GET'
  ) {
    return {
      action: 'DOWNLOAD_FILE',
      entity_type: entityType,
      entity_id: entityId,
      summary: `${entityLabelUz} faylini yuklab oldi`,
      severity: 'INFO',
      shouldAudit: true,
    };
  }

  // Xavfsizlik xatolari (401, 403, 429)
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    return {
      action: statusCode === 429 ? 'RATE_LIMIT_BLOCKED' : 'ACCESS_DENIED',
      entity_type: entityType,
      entity_id: entityId,
      summary:
        statusCode === 429
          ? `So‘rovlar limiti oshib ketdi (${path})`
          : `Ruxsatsiz kirish urinishi (${statusCode}: ${method} ${path})`,
      severity: statusCode === 403 ? 'CRITICAL' : 'WARNING',
      shouldAudit: true,
    };
  }

  // O'zgartiruvchi CRUD amallar
  if (MUTATING_METHODS.has(method)) {
    // Audit settings/block-ip o'zining maxsus audit logini yozadi — dublikat qilmaymiz
    if (path.startsWith('/audit/')) {
      return {
        action: 'AUDIT_ACTION',
        entity_type: 'security',
        entity_id: entityId,
        summary: '',
        severity: 'INFO',
        shouldAudit: false,
      };
    }

    if (method === 'POST') {
      return {
        action: 'CREATE',
        entity_type: entityType,
        entity_id: entityId,
        summary: `Yangi ${entityLabelUz.toLowerCase()} yaratdi`,
        severity: entityType === 'user' ? 'WARNING' : 'INFO',
        shouldAudit: true,
      };
    }
    if (method === 'PATCH' || method === 'PUT') {
      return {
        action: 'UPDATE',
        entity_type: entityType,
        entity_id: entityId,
        summary: `${entityLabelUz} ma’lumotlarini tahrirladi`,
        severity: entityType === 'user' ? 'WARNING' : 'INFO',
        shouldAudit: true,
      };
    }
    if (method === 'DELETE') {
      return {
        action: 'DELETE',
        entity_type: entityType,
        entity_id: entityId,
        summary: `${entityLabelUz} yozuvini o‘chirdi`,
        severity: entityType === 'user' || entityType === 'application' ? 'CRITICAL' : 'WARNING',
        shouldAudit: true,
      };
    }
  }

  return {
    action: 'API_REQUEST',
    entity_type: entityType,
    entity_id: entityId,
    summary: `${method} ${path}`,
    severity: 'INFO',
    shouldAudit: false,
  };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtAccessPayload; __auditLogged?: boolean }>();
    const res = context.switchToHttp().getResponse<Response>();

    const method = req.method?.toUpperCase() || 'GET';
    const rawPath = req.path || req.originalUrl?.split('?')[0] || '/';
    if (rawPath.includes('/events/stream')) {
      return next.handle();
    }
    const ip = (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = res.statusCode || 200;
          void this.auditService.recordTraffic(ip, method, rawPath, statusCode);

          const bodyUsername =
            req.body && typeof (req.body as Record<string, unknown>).username === 'string'
              ? ((req.body as Record<string, unknown>).username as string)
              : null;
          const username = req.user?.username ?? bodyUsername;

          const classified = classifyAuditEvent(method, rawPath, statusCode, username);
          if (classified.shouldAudit) {
            void this.auditService.log({
              user_id: req.user?.sub ?? null,
              username,
              role: req.user?.role ?? null,
              action: classified.action,
              entity_type: classified.entity_type,
              entity_id: classified.entity_id,
              summary: classified.summary,
              details: MUTATING_METHODS.has(method) ? sanitizePayload(req.body) : null,
              method,
              path: rawPath,
              ip,
              user_agent: userAgent,
              status_code: statusCode,
              is_success: true,
              severity: classified.severity,
              duration_ms: Date.now() - startedAt,
            });
          }
        },
        error: (err: { status?: number; getStatus?: () => number; message?: string }) => {
          const statusCode =
            typeof err?.getStatus === 'function' ? err.getStatus() : err?.status || 500;
          void this.auditService.recordTraffic(ip, method, rawPath, statusCode);

          const bodyUsername =
            req.body && typeof (req.body as Record<string, unknown>).username === 'string'
              ? ((req.body as Record<string, unknown>).username as string)
              : null;
          const username = req.user?.username ?? bodyUsername;

          const classified = classifyAuditEvent(method, rawPath, statusCode, username);
          if (classified.shouldAudit) {
            req.__auditLogged = true;
            void this.auditService.log({
              user_id: req.user?.sub ?? null,
              username,
              role: req.user?.role ?? null,
              action: classified.action,
              entity_type: classified.entity_type,
              entity_id: classified.entity_id,
              summary: classified.summary,
              details: {
                error: err?.message || 'Xatolik',
                ...(MUTATING_METHODS.has(method) ? sanitizePayload(req.body) || {} : {}),
              },
              method,
              path: rawPath,
              ip,
              user_agent: userAgent,
              status_code: statusCode,
              is_success: false,
              severity: classified.severity,
              duration_ms: Date.now() - startedAt,
            });
          }
        },
      }),
    );
  }
}
