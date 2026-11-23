import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Citizen } from '../applications/citizens/citizen.entity';
import { District } from '../applications/districts/district.entity';
import { ApplicationStatus } from '../applications/statuses/application-status.entity';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';
import { DetectedCrimeStatusesService } from './detected-crime-statuses.service';
import {
  DetectedCrimesController,
  DetectedCrimeStatusesController,
  DetectionSourcesController,
} from './detected-crimes.controller';
import { DetectedCrimesService } from './detected-crimes.service';
import { DetectionSourcesService } from './detection-sources.service';
import { DetectedCrime } from './entities/detected-crime.entity';
import { DetectedCrimeEvidence } from './entities/detected-crime-evidence.entity';
import { DetectedCrimeStatus } from './entities/detected-crime-status.entity';
import { DetectedCrimeSuspect } from './entities/detected-crime-suspect.entity';
import { DetectionSource } from './entities/detection-source.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DetectionSource,
      DetectedCrimeStatus,
      DetectedCrime,
      DetectedCrimeSuspect,
      DetectedCrimeEvidence,
      ApplicationStatus,
      District,
      Citizen,
      User,
    ]),
    AuthModule,
  ],
  controllers: [
    DetectionSourcesController,
    DetectedCrimeStatusesController,
    DetectedCrimesController,
  ],
  providers: [DetectionSourcesService, DetectedCrimeStatusesService, DetectedCrimesService],
  exports: [DetectionSourcesService, DetectedCrimeStatusesService, DetectedCrimesService],
})
export class DetectedCrimesModule {}
