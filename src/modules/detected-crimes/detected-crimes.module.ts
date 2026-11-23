import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Citizen } from '../applications/citizens/citizen.entity';
import { ApplicationStatus } from '../applications/statuses/application-status.entity';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';
import { DetectedCrimesController, DetectionSourcesController } from './detected-crimes.controller';
import { DetectedCrimesService } from './detected-crimes.service';
import { DetectionSourcesService } from './detection-sources.service';
import { DetectedCrime } from './entities/detected-crime.entity';
import { DetectedCrimeEvidence } from './entities/detected-crime-evidence.entity';
import { DetectedCrimeSuspect } from './entities/detected-crime-suspect.entity';
import { DetectionSource } from './entities/detection-source.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DetectionSource,
      DetectedCrime,
      DetectedCrimeSuspect,
      DetectedCrimeEvidence,
      ApplicationStatus,
      Citizen,
      User,
    ]),
    AuthModule,
  ],
  controllers: [DetectionSourcesController, DetectedCrimesController],
  providers: [DetectionSourcesService, DetectedCrimesService],
  exports: [DetectionSourcesService, DetectedCrimesService],
})
export class DetectedCrimesModule {}
