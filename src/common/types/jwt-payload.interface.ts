import { Role } from '../enums/role.enum';

export interface JwtAccessPayload {
  sub: string;
  username: string;
  role: Role;
  is_root?: boolean;
  issued_at_ms?: number;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
}

export interface AuthenticatedRequest {
  user?: JwtAccessPayload;
  cookies?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}
