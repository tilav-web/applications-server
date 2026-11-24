import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { LatinNormalizePipe } from './common/pipes/latin-normalize.pipe';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Nginx / reverse proxy ortida haqiqiy client IP ni xavfsiz aniqlash (X-Forwarded-For spoofing oldini olish)
  app.set('trust proxy', 1);

  // HTTP xavfsizlik sarlavhalari (CSP, X-Frame-Options, X-Content-Type-Options, HSTS va b.)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cookieParser());

  app.useGlobalPipes(
    new LatinNormalizePipe(),
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Qat'iy CORS siyosati — origin: true o'rniga ruxsat etilgan manzillar ro'yxati
  const isProduction = process.env.NODE_ENV === 'production';
  const rawOrigins = process.env.CORS_ORIGINS || '';
  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (!isProduction && allowedOrigins.length === 0) {
    allowedOrigins.push('http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173');
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Server-to-server, curl, same-origin yoki OnlyOffice ichki so'rovlari (Origin sarlavhasi yo'q)
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      logger.warn(`CORS bloklandi: ruxsat etilmagan origin -> ${origin}`);
      callback(new Error('CORS: Ushbu manzildan kirish taqiqlangan'), false);
    },
    credentials: true,
    exposedHeaders: ['x-new-access-token'],
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
