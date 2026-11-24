import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { AuditService } from './audit.service';

@Injectable()
export class IpBlockMiddleware implements NestMiddleware {
  constructor(private readonly auditService: AuditService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const blocked = await this.auditService.isIpBlocked(ip);
    if (blocked) {
      const method = req.method?.toUpperCase() || 'GET';
      const rawPath = req.path || req.originalUrl?.split('?')[0] || '/';
      void this.auditService.recordTraffic(ip, method, rawPath, 403);
      res.status(403).json({
        statusCode: 403,
        message: 'Ushbu IP manzil xavfsizlik sababli vaqtincha bloklangan',
        error: 'Forbidden',
      });
      return;
    }

    next();
  }
}
