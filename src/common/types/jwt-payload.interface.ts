import { Role } from '../enums/role.enum';

export interface JwtAccessPayload {
  sub: string;
  username: string;
  role: Role;
}

export interface JwtRefreshPayload {
  sub: string;
}

export interface AuthenticatedRequest {
  user?: JwtAccessPayload;
  cookies?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}
