import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = parseInt(this.configService.get<string>('REDIS_PORT', '6379'), 10);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        const delay = Math.min(200 * Math.pow(2, Math.min(times - 1, 6)), 10_000);
        if (times === 1 || times % 5 === 0) {
          this.logger.warn(`Redisga qayta ulanish (${times}-urinish, ${delay}ms)...`);
        }
        return delay;
      },
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.logger.log(`Redisga muvaffaqiyatli ulandi va tayyor: ${host}:${port}`);
    });

    this.client.on('connect', () => {
      this.logger.log(`Redis TCP aloqasi o'rnatildi: ${host}:${port}`);
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });

    this.client.on('end', () => {
      this.isConnected = false;
    });

    this.client.on('error', (err: Error) => {
      this.isConnected = false;
      this.logger.warn(`Redis ulanishida xatolik: ${err.message}`);
    });

    this.client.connect().catch((err: Error) => {
      this.isConnected = false;
      this.logger.warn(`Redis dastlabki ulanish xatosi: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
  }

  getClient(): Redis | null {
    if (!this.client || !this.isConnected) {
      return null;
    }
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis get xatosi [key=${key}]: ${msg}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        return await this.client.set(key, value, 'EX', ttlSeconds);
      }
      return await this.client.set(key, value);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis set xatosi [key=${key}]: ${msg}`);
      return null;
    }
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }
    try {
      const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis setNx xatosi [key=${key}]: ${msg}`);
      return false;
    }
  }

  async del(key: string): Promise<number> {
    if (!this.client || !this.isConnected) {
      return 0;
    }
    try {
      return await this.client.del(key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis del xatosi [key=${key}]: ${msg}`);
      return 0;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<'OK' | null> {
    try {
      const serialized = JSON.stringify(value);
      return await this.set(key, serialized, ttlSeconds);
    } catch {
      return null;
    }
  }
}
