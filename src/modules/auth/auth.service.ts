import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { JwtAccessPayload, JwtRefreshPayload } from '../../common/types/jwt-payload.interface';
import type { UserProfileResponse } from '../../common/types/user-profile.interface';
import { RedisService } from '../redis/redis.service';
import { User } from '../users/user.entity';
import { Auth } from './auth.entity';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshInFlight = new Map<
    string,
    Promise<{ accessToken: string; refreshToken: string; auth: Auth }>
  >();
  private readonly recentRefreshes = new Map<
    string,
    { accessToken: string; refreshToken: string; auth: Auth; expiresAt: number }
  >();

  constructor(
    @InjectRepository(Auth)
    private readonly authRepository: Repository<Auth>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.validateSecurityConfig();
    await this.seedSuperAdmin();
  }

  private validateSecurityConfig(): void {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    if (!isProduction) return;

    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');

    if (
      !accessSecret ||
      accessSecret === 'uvd_access_token_secret_key_2026' ||
      accessSecret.length < 32
    ) {
      throw new Error(
        'XAVFSIZLIK XATOLIGI: Production muhitida JWT_ACCESS_SECRET kamida 32 belgilik maxfiy kalit bo‘lishi shart!',
      );
    }

    if (
      !refreshSecret ||
      refreshSecret === 'uvd_refresh_token_secret_key_2026' ||
      refreshSecret.length < 32
    ) {
      throw new Error(
        'XAVFSIZLIK XATOLIGI: Production muhitida JWT_REFRESH_SECRET kamida 32 belgilik maxfiy kalit bo‘lishi shart!',
      );
    }
  }

  async seedSuperAdmin(): Promise<void> {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const username = this.configService.get<string>('SUPER_ADMIN_USERNAME', 'admin');
    const password = this.configService.get<string>('SUPER_ADMIN_PASSWORD');
    const firstName = this.configService.get<string>('SUPER_ADMIN_FIRST_NAME', 'Admin');
    const lastName = this.configService.get<string>('SUPER_ADMIN_LAST_NAME', 'Boshqaruvchi');
    const phoneNumber = this.configService.get<string>('SUPER_ADMIN_PHONE', '+998901234567');

    try {
      // 1. Agar tizimda Root Super Admin allaqachon mavjud bo'lsa (login o'zgartirilgan bo'lsa ham),
      // qayta yangi super admin yaratmaymiz.
      const existingRoot = await this.authRepository.findOne({
        where: { is_root: true },
        relations: { user: true },
      });

      if (existingRoot) {
        if (!existingRoot.user) {
          const profile = this.userRepository.create({
            auth_id: existingRoot.id,
            first_name: firstName,
            last_name: lastName,
            phone_number: phoneNumber,
          });
          await this.userRepository.save(profile);
          this.logger.log(
            `Root Super Admin uchun profil yaratildi (username: ${existingRoot.username})`,
          );
        }
        return;
      }

      // 2. Root belgilanmagan bo'lsa, mavjud SUPER_ADMIN (yoki env username) ni root qilib belgilaymiz
      const existingSuperAdmin =
        (await this.authRepository.findOne({
          where: { username },
          relations: { user: true },
        })) ??
        (await this.authRepository.findOne({
          where: { role: Role.SUPER_ADMIN },
          relations: { user: true },
          order: { created_at: 'ASC' },
        }));

      if (existingSuperAdmin) {
        if (existingSuperAdmin.role === Role.SUPER_ADMIN && !existingSuperAdmin.is_root) {
          existingSuperAdmin.is_root = true;
          await this.authRepository.save(existingSuperAdmin);
          this.logger.log(
            `Root Super Admin belgisi tiklandi (username: ${existingSuperAdmin.username})`,
          );
        }
        if (!existingSuperAdmin.user) {
          const profile = this.userRepository.create({
            auth_id: existingSuperAdmin.id,
            first_name: firstName,
            last_name: lastName,
            phone_number: phoneNumber,
          });
          await this.userRepository.save(profile);
          this.logger.log(
            `Super admin uchun profil yaratildi (username: ${existingSuperAdmin.username})`,
          );
        }
        return;
      }

      if (isProduction && (!password || password === 'admin123' || password.length < 10)) {
        this.logger.error(
          '[Seed] Production muhitida zaif yoki bo‘sh SUPER_ADMIN_PASSWORD bilan admin yaratilmaydi!',
        );
        return;
      }

      const finalPassword = password || 'admin123';
      const hashedPassword = await bcrypt.hash(finalPassword, 10);
      const auth = this.authRepository.create({
        username,
        password: hashedPassword,
        role: Role.SUPER_ADMIN,
        is_root: true,
      });

      const savedAuth = await this.authRepository.save(auth);

      const user = this.userRepository.create({
        auth_id: savedAuth.id,
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneNumber,
      });

      await this.userRepository.save(user);

      this.logger.log(`[Seed] Super admin muvaffaqiyatli yaratildi! (Username: ${username})`);
    } catch (error) {
      this.logger.error('[Seed] Super adminni yaratishda xatolik yuz berdi:', error);
    }
  }

  public getAccessSecret(): string {
    return this.configService.get<string>('JWT_ACCESS_SECRET', 'uvd_access_token_secret_key_2026');
  }

  private get accessSecret(): string {
    return this.getAccessSecret();
  }

  private get refreshSecret(): string {
    return this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      'uvd_refresh_token_secret_key_2026',
    );
  }

  // Bcrypt 72-bayt cheklovini aylanib o'tish uchun JWT ni avval SHA-256 bilan xeshlaymiz
  private digestTokenForBcrypt(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDurationSeconds(raw: string | undefined, fallbackSeconds: number): number {
    if (!raw) return fallbackSeconds;
    const trimmed = raw.trim();
    const match = /^(\d+)\s*([smhd])?$/i.exec(trimmed);
    if (!match) return fallbackSeconds;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return fallbackSeconds;
    const unit = (match[2] || 's').toLowerCase();
    const multiplier = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    return amount * multiplier;
  }

  // Default 15 minut (sekundlarda) — JWT_ACCESS_EXPIRES_IN env dan o'qiladi
  private get accessExpiresIn(): number {
    return this.parseDurationSeconds(
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN'),
      15 * 60,
    );
  }

  // Default 7 kun (sekundlarda) — JWT_REFRESH_EXPIRES_IN env dan o'qiladi
  private get refreshExpiresIn(): number {
    return this.parseDurationSeconds(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN'),
      7 * 24 * 60 * 60,
    );
  }

  private getProfileCacheKey(authId: string): string {
    return `user:profile:${authId}`;
  }

  private getRevokedBeforeKey(authId: string): string {
    return `auth:revoked_before:${authId}`;
  }

  private clearRecentRefreshesForUser(authId: string): void {
    for (const [key, entry] of this.recentRefreshes.entries()) {
      if (entry.auth.id === authId || entry.expiresAt <= Date.now()) {
        this.recentRefreshes.delete(key);
      }
    }
  }

  async invalidateProfileCache(authId: string): Promise<void> {
    await this.redisService.del(this.getProfileCacheKey(authId));
  }

  async revokeUserTokens(authId: string): Promise<void> {
    const nowMs = Date.now();
    this.clearRecentRefreshesForUser(authId);
    await this.redisService.set(
      this.getRevokedBeforeKey(authId),
      String(nowMs),
      this.accessExpiresIn + 60,
    );
    await this.invalidateProfileCache(authId);
  }

  async isTokenRevoked(authId: string, issuedAtMs?: number, iatSec?: number): Promise<boolean> {
    const rawRevoked = await this.redisService.get(this.getRevokedBeforeKey(authId));
    if (!rawRevoked) return false;
    const revokedBeforeMs = Number(rawRevoked);
    if (!Number.isFinite(revokedBeforeMs)) return false;
    const tokenIssuedMs =
      typeof issuedAtMs === 'number' && Number.isFinite(issuedAtMs)
        ? issuedAtMs
        : typeof iatSec === 'number' && Number.isFinite(iatSec)
          ? iatSec * 1000
          : 0;
    return tokenIssuedMs <= revokedBeforeMs;
  }

  async validateUser(dto: LoginDto): Promise<Auth> {
    const auth = await this.authRepository.findOne({
      where: { username: dto.username },
      relations: { user: true },
    });

    if (!auth) {
      throw new UnauthorizedException("Login yoki parol noto'g'ri");
    }

    const isPasswordValid = await bcrypt.compare(dto.password, auth.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Login yoki parol noto'g'ri");
    }

    return auth;
  }

  async generateTokens(auth: Auth): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const accessPayload: JwtAccessPayload = {
      sub: auth.id,
      username: auth.username,
      role: auth.role,
      is_root: Boolean(auth.is_root),
      issued_at_ms: Date.now(),
    };

    const refreshPayload: JwtRefreshPayload = {
      sub: auth.id,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: this.accessExpiresIn,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshExpiresIn,
      }),
    ]);

    const hashedRefreshToken = await bcrypt.hash(this.digestTokenForBcrypt(refreshToken), 10);
    await this.authRepository.update(auth.id, {
      hashed_refresh_token: hashedRefreshToken,
    });

    return { accessToken, refreshToken };
  }

  private get isCookieSecure(): boolean {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const override = this.configService.get<string>('COOKIE_SECURE');
    if (override !== undefined && override !== '') {
      return override === 'true';
    }
    return isProduction;
  }

  setAccessTokenCookie(res: Response, accessToken: string): void {
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: this.isCookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.accessExpiresIn * 1000,
    });
  }

  setRefreshTokenCookie(res: Response, refreshToken: string): void {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.isCookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.refreshExpiresIn * 1000,
    });
  }

  clearAuthCookies(res: Response): void {
    const cookieOpts = {
      httpOnly: true,
      secure: this.isCookieSecure,
      sameSite: 'lax' as const,
      path: '/',
    };
    res.clearCookie('refresh_token', cookieOpts);
    res.clearCookie('access_token', cookieOpts);
  }

  /**
   * Qat'iy faol sessiya tekshiruvi (muddati tugagan yoki bekor qilingan tokenlar rad etiladi).
   * Fayl/hujjat yuklab olish kabi himoyalangan endpointlar uchun ishlatiladi.
   */
  async verifyActiveAccessRequest(req: Request): Promise<JwtAccessPayload | null> {
    const reqUser = (req as { user?: JwtAccessPayload }).user;
    if (reqUser?.sub) {
      const revoked = await this.isTokenRevoked(reqUser.sub, reqUser.issued_at_ms, reqUser.iat);
      return revoked ? null : reqUser;
    }

    const authHeader = req.headers.authorization;
    const cookies = req.cookies as Record<string, string> | undefined;
    const accessToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : cookies?.['access_token'];

    if (accessToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(accessToken, {
          secret: this.accessSecret,
        });
        if (payload?.sub) {
          const revoked = await this.isTokenRevoked(payload.sub, payload.issued_at_ms, payload.iat);
          if (!revoked) {
            return payload;
          }
        }
      } catch {
        // Muddati o'tgan yoki yaroqsiz access token
      }
    }

    const refreshToken = cookies?.['refresh_token'];
    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(refreshToken, {
          secret: this.refreshSecret,
        });
        if (payload?.sub) {
          const auth = await this.authRepository.findOne({ where: { id: payload.sub } });
          if (auth && auth.hashed_refresh_token) {
            const isMatch = await bcrypt.compare(
              this.digestTokenForBcrypt(refreshToken),
              auth.hashed_refresh_token,
            );
            if (isMatch) {
              return {
                sub: auth.id,
                username: auth.username,
                role: auth.role,
                is_root: Boolean(auth.is_root),
              };
            }
          }
        }
      } catch {
        // Yaroqsiz refresh token
      }
    }

    return null;
  }

  /**
   * Faqat /auth/logout uchun: muddati tugagan access tokendan ham authId ni aniqlab,
   * bazadagi refresh tokenni tozalash imkonini beradi.
   */
  async resolveAuthIdFromRequest(req: Request): Promise<string | null> {
    const reqUser = (req as { user?: Partial<JwtAccessPayload> }).user;
    if (reqUser?.sub) {
      return reqUser.sub;
    }

    const authHeader = req.headers.authorization;
    const cookies = req.cookies as Record<string, string> | undefined;
    const accessToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : cookies?.['access_token'];

    if (accessToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(accessToken, {
          secret: this.accessSecret,
          ignoreExpiration: true,
        });
        if (payload?.sub) return payload.sub;
      } catch {
        // ignore invalid access token
      }
    }

    const refreshToken = cookies?.['refresh_token'];
    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(refreshToken, {
          secret: this.refreshSecret,
        });
        if (payload?.sub) return payload.sub;
      } catch {
        // ignore invalid refresh token
      }
    }

    return null;
  }

  async login(
    dto: LoginDto,
    res: Response,
  ): Promise<{
    access_token: string;
    user: {
      id: string;
      username: string;
      role: string;
      is_root: boolean;
      profile: {
        id?: string;
        first_name: string | null;
        last_name: string | null;
        phone_number: string | null;
      } | null;
    };
  }> {
    const auth = await this.validateUser(dto);
    const { accessToken, refreshToken } = await this.generateTokens(auth);

    this.setAccessTokenCookie(res, accessToken);
    this.setRefreshTokenCookie(res, refreshToken);

    const profileData = {
      id: auth.id,
      username: auth.username,
      role: auth.role,
      is_root: Boolean(auth.is_root),
      profile: auth.user
        ? {
            id: auth.user.id,
            first_name: auth.user.first_name,
            last_name: auth.user.last_name,
            phone_number: auth.user.phone_number,
          }
        : null,
    };

    // Redis keshiga ham saqlaymiz
    await this.redisService.setJson(
      this.getProfileCacheKey(auth.id),
      {
        ...profileData,
        created_at: auth.created_at,
        updated_at: auth.updated_at,
        profile: auth.user
          ? {
              id: auth.user.id,
              first_name: auth.user.first_name,
              last_name: auth.user.last_name,
              phone_number: auth.user.phone_number,
              created_at: auth.user.created_at,
              updated_at: auth.user.updated_at,
            }
          : null,
      },
      3600,
    );

    return {
      access_token: accessToken,
      user: profileData,
    };
  }

  async refreshTokens(
    refreshToken: string,
    res?: Response,
  ): Promise<{
    accessToken: string;
    auth: Auth;
  }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Sessiya muddati tugagan, iltimos qaytadan kiring');
    }

    const tokenDigest = this.digestTokenForBcrypt(refreshToken);

    // Parallel so'rovlar bir vaqtda muddati o'tgan access token bilan kelganda
    // refresh rotatsiya poygasini (race condition) oldini olish uchun 5 soniyalik grace kesh
    const now = Date.now();
    for (const [k, entry] of this.recentRefreshes.entries()) {
      if (entry.expiresAt <= now) {
        this.recentRefreshes.delete(k);
      }
    }

    const cached = this.recentRefreshes.get(tokenDigest);
    if (cached && cached.expiresAt > now) {
      if (res) {
        this.setAccessTokenCookie(res, cached.accessToken);
        this.setRefreshTokenCookie(res, cached.refreshToken);
        res.setHeader('x-new-access-token', cached.accessToken);
      }
      return { accessToken: cached.accessToken, auth: cached.auth };
    }

    let pending = this.refreshInFlight.get(tokenDigest);
    if (!pending) {
      pending = (async () => {
        let payload: JwtRefreshPayload;
        try {
          payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(refreshToken, {
            secret: this.refreshSecret,
          });
        } catch {
          throw new UnauthorizedException('Sessiya muddati tugagan, iltimos qaytadan kiring');
        }

        const auth = await this.authRepository.findOne({
          where: { id: payload.sub },
          relations: { user: true },
        });

        if (!auth || !auth.hashed_refresh_token) {
          throw new UnauthorizedException('Sessiya muddati tugagan, iltimos qaytadan kiring');
        }

        const isMatch = await bcrypt.compare(tokenDigest, auth.hashed_refresh_token);
        if (!isMatch) {
          throw new UnauthorizedException('Sessiya muddati tugagan, iltimos qaytadan kiring');
        }

        const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
          await this.generateTokens(auth);

        this.recentRefreshes.set(tokenDigest, {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          auth,
          expiresAt: Date.now() + 5000,
        });

        return { accessToken: newAccessToken, refreshToken: newRefreshToken, auth };
      })();

      this.refreshInFlight.set(tokenDigest, pending);
      void pending.finally(() => {
        this.refreshInFlight.delete(tokenDigest);
      });
    }

    const result = await pending;

    if (res) {
      this.setAccessTokenCookie(res, result.accessToken);
      this.setRefreshTokenCookie(res, result.refreshToken);
      res.setHeader('x-new-access-token', result.accessToken);
    }

    return { accessToken: result.accessToken, auth: result.auth };
  }

  async logout(authId: string | null, res: Response): Promise<{ message: string }> {
    if (authId) {
      await this.authRepository.update(authId, {
        hashed_refresh_token: null,
      });
      // Aktiv access tokenlarni ham, Redis profil keshini ham darhol bekor qilamiz
      await this.revokeUserTokens(authId);
    }

    this.clearAuthCookies(res);

    return { message: 'Muvaffaqiyatli tizimdan chiqildi' };
  }

  async getProfile(authId: string): Promise<UserProfileResponse> {
    const cacheKey = this.getProfileCacheKey(authId);

    // 1. Dastlab Redis keshidan tekshiramiz (Cache HIT)
    const cachedProfile = await this.redisService.getJson<UserProfileResponse>(cacheKey);
    if (cachedProfile && typeof cachedProfile.is_root === 'boolean') {
      return cachedProfile;
    }

    // 2. Keshda topilmasa, ma'lumotlar bazasidan olamiz (Cache MISS)
    const auth = await this.authRepository.findOne({
      where: { id: authId },
      relations: { user: true },
    });

    if (!auth) {
      throw new NotFoundException('Hodim topilmadi');
    }

    const profileData: UserProfileResponse = {
      id: auth.id,
      username: auth.username,
      role: auth.role,
      is_root: Boolean(auth.is_root),
      created_at: auth.created_at,
      updated_at: auth.updated_at,
      profile: auth.user
        ? {
            id: auth.user.id,
            first_name: auth.user.first_name,
            last_name: auth.user.last_name,
            phone_number: auth.user.phone_number,
            created_at: auth.user.created_at,
            updated_at: auth.user.updated_at,
          }
        : null,
    };

    // 3. Redis keshiga 1 soat (3600 soniya) ga saqlab qo'yamiz
    await this.redisService.setJson(cacheKey, profileData, 3600);

    return profileData;
  }

  async updateProfile(authId: string, dto: UpdateProfileDto): Promise<UserProfileResponse> {
    const auth = await this.authRepository.findOne({
      where: { id: authId },
      relations: { user: true },
    });

    if (!auth) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    // 1. Agar username o'zgartirilayotgan bo'lsa
    if (dto.username && dto.username !== auth.username) {
      const existing = await this.authRepository.findOne({
        where: { username: dto.username },
      });
      if (existing && existing.id !== authId) {
        throw new ConflictException('Ushbu username allaqachon band qilingan');
      }
      await this.authRepository.update(auth.id, { username: dto.username });
    }

    // 2. Agar yangi parol berilgan bo'lsa — hozirgi parol majburiy tekshiriladi va barcha sessiyalar bekor qilinadi
    const newPassword = dto.new_password || dto.password;
    if (newPassword) {
      if (!dto.current_password) {
        throw new BadRequestException("Parolni o'zgartirish uchun hozirgi parolni kiriting");
      }
      const isCurrentValid = await bcrypt.compare(dto.current_password, auth.password);
      if (!isCurrentValid) {
        throw new BadRequestException("Hozirgi parol noto'g'ri kiritildi");
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await this.authRepository.update(auth.id, {
        password: hashedPassword,
        hashed_refresh_token: null,
      });
      await this.revokeUserTokens(auth.id);
    }

    // 3. Profil ma'lumotlarini yangilash (ism, familiya, telefon)
    if (
      dto.first_name !== undefined ||
      dto.last_name !== undefined ||
      dto.phone_number !== undefined
    ) {
      if (auth.user) {
        await this.userRepository.update(auth.user.id, {
          ...(dto.first_name !== undefined && { first_name: dto.first_name }),
          ...(dto.last_name !== undefined && { last_name: dto.last_name }),
          ...(dto.phone_number !== undefined && {
            phone_number: dto.phone_number,
          }),
        });
      } else {
        const newUser = this.userRepository.create({
          auth_id: auth.id,
          first_name: dto.first_name ?? null,
          last_name: dto.last_name ?? null,
          phone_number: dto.phone_number ?? null,
        });
        await this.userRepository.save(newUser);
      }
    }

    // 4. Bazadan eng yangi ma'lumotni yuklab olamiz
    const updatedAuth = await this.authRepository.findOne({
      where: { id: authId },
      relations: { user: true },
    });

    if (!updatedAuth) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    const updatedProfile: UserProfileResponse = {
      id: updatedAuth.id,
      username: updatedAuth.username,
      role: updatedAuth.role,
      is_root: Boolean(updatedAuth.is_root),
      created_at: updatedAuth.created_at,
      updated_at: updatedAuth.updated_at,
      profile: updatedAuth.user
        ? {
            id: updatedAuth.user.id,
            first_name: updatedAuth.user.first_name,
            last_name: updatedAuth.user.last_name,
            phone_number: updatedAuth.user.phone_number,
            created_at: updatedAuth.user.created_at,
            updated_at: updatedAuth.user.updated_at,
          }
        : null,
    };

    // 5. Redis keshini darhol yangilaymiz (eski ma'lumotlar qolib ketmasligi uchun)
    const cacheKey = this.getProfileCacheKey(authId);
    await this.redisService.setJson(cacheKey, updatedProfile, 3600);

    return updatedProfile;
  }
}
