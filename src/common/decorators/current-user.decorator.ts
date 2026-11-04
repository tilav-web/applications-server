import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { JwtAccessPayload } from '../types/jwt-payload.interface';

export const CurrentUser = createParamDecorator(
  (
    data: keyof JwtAccessPayload | undefined,
    ctx: ExecutionContext,
  ): JwtAccessPayload | string | null => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: JwtAccessPayload }>();
    const user = request.user;
    if (!user) {
      return null;
    }
    return data ? user[data] : user;
  },
);
