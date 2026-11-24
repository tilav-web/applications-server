import 'dotenv/config';

import { DataSource } from 'typeorm';

const isProduction = process.env.NODE_ENV === 'production';
const dbPassword = process.env.DB_PASSWORD;
if (isProduction && (!dbPassword || dbPassword === 'postgres_password_2026')) {
  throw new Error(
    'XAVFSIZLIK XATOLIGI: Production muhitida DB_PASSWORD kuchli maxfiy qiymat bilan sozlanishi shart!',
  );
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5434', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: dbPassword || 'postgres_password_2026',
  database: process.env.DB_NAME || 'uvd_app_db',
  entities: [__dirname + '/modules/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
