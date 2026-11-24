import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { DistrictsService } from '../modules/applications/districts/districts.service';
import { NeighborhoodsService } from '../modules/applications/neighborhoods/neighborhoods.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const districtsService = app.get(DistrictsService);
  const neighborhoodsService = app.get(NeighborhoodsService);

  console.log('Qashqadaryo tumanlarini bazaga kiritish boshlandi...');
  await districtsService.seedDefaultDistricts();

  console.log('Qashqadaryo mahallalarini bazaga kiritish boshlandi...');
  await neighborhoodsService.seedDefaultNeighborhoods();

  console.log('Barcha tumanlar va mahallalar muvaffaqiyatli bazaga kiritildi!');
  await app.close();
}

bootstrap().catch((err) => {
  console.error('Seed scriptida xatolik yuz berdi:', err);
  process.exit(1);
});
