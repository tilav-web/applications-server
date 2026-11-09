import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DistrictsService } from '../modules/applications/districts/districts.service';
import { MahallasService } from '../modules/applications/mahallas/mahallas.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const districtsService = app.get(DistrictsService);
  const mahallasService = app.get(MahallasService);

  console.log("Qashqadaryo tumanlarini bazaga kiritish boshlandi...");
  await districtsService.seedDefaultDistricts();

  console.log("Qashqadaryo mahallalarini bazaga kiritish boshlandi...");
  await mahallasService.seedDefaultMahallas();

  console.log("Barcha tumanlar va mahallalar muvaffaqiyatli bazaga kiritildi!");
  await app.close();
}

bootstrap().catch((err) => {
  console.error("Seed scriptida xatolik yuz berdi:", err);
  process.exit(1);
});

