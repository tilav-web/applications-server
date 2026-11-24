import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { type Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Repository } from 'typeorm';

import { Application } from '../applications/application.entity';
import { SystemSetting } from '../audit/system-setting.entity';
import { DetectedCrime } from '../detected-crimes/entities/detected-crime.entity';
import { NotificationsService } from './notifications.service';

export type SlaStage = 'WARN_72H' | 'URGENT_24H' | 'OVERDUE_0H' | 'ESCALATE_24H';
export type SlaEntityType = 'APPLICATION' | 'DETECTED_CRIME';

export interface SlaJobData {
  entityType?: SlaEntityType;
  applicationId: string;
  stage: SlaStage;
  deadlineIso: string;
}

const SLA_QUEUE_NAME = 'application-sla-queue';
const ALL_STAGES: SlaStage[] = ['WARN_72H', 'URGENT_24H', 'OVERDUE_0H', 'ESCALATE_24H'];

@Injectable()
export class SlaQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaQueueService.name);
  private queueConnection: IORedis | null = null;
  private workerConnection: IORedis | null = null;
  private queue: Queue<SlaJobData> | null = null;
  private worker: Worker<SlaJobData> | null = null;
  private queueReady = false;
  private workerReady = false;

  private get isReady(): boolean {
    return this.queueReady && this.workerReady && Boolean(this.queue);
  }

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Application)
    private readonly applicationRepo: Repository<Application>,
    @InjectRepository(DetectedCrime)
    private readonly detectedCrimeRepo: Repository<DetectedCrime>,
    @InjectRepository(SystemSetting)
    private readonly settingRepo: Repository<SystemSetting>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const host = this.configService.get<string>('REDIS_HOST', 'localhost');
      const port = parseInt(this.configService.get<string>('REDIS_PORT', '6379'), 10);
      const password = this.configService.get<string>('REDIS_PASSWORD', '') || undefined;

      const baseOpts = {
        host,
        port,
        password,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(250 * Math.pow(2, Math.min(times - 1, 6)), 10_000);
          if (times === 1 || times % 5 === 0) {
            this.logger.warn(`BullMQ Redis qayta ulanish (${times}-urinish, ${delay}ms)...`);
          }
          return delay;
        },
      };

      this.queueConnection = new IORedis(baseOpts);
      this.workerConnection = new IORedis(baseOpts);

      this.queueConnection.on('ready', () => {
        this.queueReady = true;
      });
      this.queueConnection.on('close', () => {
        this.queueReady = false;
      });
      this.queueConnection.on('end', () => {
        this.queueReady = false;
      });
      this.queueConnection.on('error', (err) => {
        this.queueReady = false;
        this.logger.warn(`BullMQ Queue Redis xatosi: ${err.message}`);
      });

      this.workerConnection.on('ready', () => {
        this.workerReady = true;
      });
      this.workerConnection.on('close', () => {
        this.workerReady = false;
      });
      this.workerConnection.on('end', () => {
        this.workerReady = false;
      });
      this.workerConnection.on('error', (err) => {
        this.workerReady = false;
        this.logger.warn(`BullMQ Worker Redis xatosi: ${err.message}`);
      });

      await Promise.all([this.queueConnection.connect(), this.workerConnection.connect()]);

      this.queue = new Queue<SlaJobData>(SLA_QUEUE_NAME, {
        connection: this.queueConnection,
        defaultJobOptions: {
          attempts: 4,
          backoff: {
            type: 'exponential',
            delay: 30_000,
          },
          removeOnComplete: 500,
          removeOnFail: 200,
        },
      });

      this.worker = new Worker<SlaJobData>(
        SLA_QUEUE_NAME,
        async (job: Job<SlaJobData>) => {
          await this.processSlaJob(job);
        },
        {
          connection: this.workerConnection,
          concurrency: 5,
        },
      );

      this.worker.on('failed', (job, err) => {
        this.logger.warn(`SLA job bajarilmadi [${job?.id}]: ${err.message}`);
      });

      this.queueReady = true;
      this.workerReady = true;
      this.logger.log(`BullMQ SLA navbati ishga tushdi (${host}:${port})`);

      // Mavjud ochiq ariza va aniqlangan jinoyatlarning joblarini fon rejimida sinxronlash
      setTimeout(() => {
        void this.reconcileAllOpenApplications();
      }, 3000);
    } catch (err) {
      this.queueReady = false;
      this.workerReady = false;
      this.logger.warn(
        `BullMQ SLA navbatini ishga tushirib bo'lmadi (Redis ulanmagan bo'lishi mumkin): ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.worker) await this.worker.close();
      if (this.queue) await this.queue.close();
      if (this.workerConnection) await this.workerConnection.quit().catch(() => {});
      if (this.queueConnection) await this.queueConnection.quit().catch(() => {});
    } catch {
      // ignore shutdown errors
    }
  }

  private buildJobId(
    entityId: string,
    stage: SlaStage,
    entityType: SlaEntityType = 'APPLICATION',
    deadlineMs?: number,
  ): string {
    const base =
      entityType === 'DETECTED_CRIME'
        ? `sla__dc__${entityId}__${stage}`
        : `sla__${entityId}__${stage}`;
    return deadlineMs ? `${base}__${deadlineMs}` : base;
  }

  private async getSettingNumber(key: string, fallback: number): Promise<number> {
    const row = await this.settingRepo.findOne({ where: { key } });
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private async loadSlaThresholds(): Promise<{
    warnHours: number;
    urgentHours: number;
    escalateHours: number;
  }> {
    const [warnHours, urgentHours, escalateHours] = await Promise.all([
      this.getSettingNumber('sla_warn_hours_before', 72),
      this.getSettingNumber('sla_urgent_hours_before', 24),
      this.getSettingNumber('sla_escalate_hours_after', 24),
    ]);
    return { warnHours, urgentHours, escalateHours };
  }

  async cancelForApplication(applicationId: string, deadlineMs?: number): Promise<void> {
    if (!this.queue || !this.isReady) return;
    try {
      for (const stage of ALL_STAGES) {
        const candidateIds = [this.buildJobId(applicationId, stage, 'APPLICATION')];
        if (deadlineMs) {
          candidateIds.push(this.buildJobId(applicationId, stage, 'APPLICATION', deadlineMs));
        }
        for (const jobId of candidateIds) {
          const job = await this.queue.getJob(jobId);
          if (job) {
            await job.remove().catch(() => {});
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `SLA joblarni bekor qilishda xato [${applicationId}]: ${(err as Error).message}`,
      );
    }
  }

  async cancelForDetectedCrime(crimeId: string, deadlineMs?: number): Promise<void> {
    if (!this.queue || !this.isReady) return;
    try {
      for (const stage of ALL_STAGES) {
        const candidateIds = [this.buildJobId(crimeId, stage, 'DETECTED_CRIME')];
        if (deadlineMs) {
          candidateIds.push(this.buildJobId(crimeId, stage, 'DETECTED_CRIME', deadlineMs));
        }
        for (const jobId of candidateIds) {
          const job = await this.queue.getJob(jobId);
          if (job) {
            await job.remove().catch(() => {});
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `DetectedCrime SLA joblarni bekor qilishda xato [${crimeId}]: ${(err as Error).message}`,
      );
    }
  }

  async scheduleForDetectedCrime(
    crimeId: string,
    preloadedThresholds?: { warnHours: number; urgentHours: number; escalateHours: number },
  ): Promise<void> {
    if (!this.queue || !this.isReady) return;
    try {
      const dc = await this.detectedCrimeRepo.findOne({
        where: { id: crimeId },
        relations: { application_status: true },
      });

      const deadlineMs = dc?.deadline_at ? new Date(dc.deadline_at).getTime() : undefined;
      await this.cancelForDetectedCrime(crimeId, deadlineMs);

      if (!dc || dc.is_deleted || dc.closed_at || !dc.deadline_at || !deadlineMs) return;
      if (dc.application_status && !dc.application_status.tracks_sla) return;

      const { warnHours, urgentHours, escalateHours } =
        preloadedThresholds || (await this.loadSlaThresholds());

      const deadlineIso = new Date(dc.deadline_at).toISOString();
      const nowMs = Date.now();

      const plan: Array<{ stage: SlaStage; fireAtMs: number }> = [];
      if (warnHours > 0) {
        plan.push({ stage: 'WARN_72H', fireAtMs: deadlineMs - warnHours * 3600 * 1000 });
      }
      if (urgentHours > 0 && urgentHours !== warnHours) {
        plan.push({ stage: 'URGENT_24H', fireAtMs: deadlineMs - urgentHours * 3600 * 1000 });
      }
      plan.push({ stage: 'OVERDUE_0H', fireAtMs: deadlineMs });
      if (escalateHours > 0) {
        plan.push({ stage: 'ESCALATE_24H', fireAtMs: deadlineMs + escalateHours * 3600 * 1000 });
      }

      for (const item of plan) {
        const delay = item.fireAtMs - nowMs;
        if (delay <= 0) continue;
        await this.queue.add(
          item.stage,
          { entityType: 'DETECTED_CRIME', applicationId: crimeId, stage: item.stage, deadlineIso },
          {
            jobId: this.buildJobId(crimeId, item.stage, 'DETECTED_CRIME', deadlineMs),
            delay,
          },
        );
      }
    } catch (err) {
      this.logger.warn(
        `DetectedCrime SLA job rejalashtirishda xato [${crimeId}]: ${(err as Error).message}`,
      );
    }
  }

  async scheduleForApplication(
    applicationId: string,
    preloadedThresholds?: { warnHours: number; urgentHours: number; escalateHours: number },
  ): Promise<void> {
    if (!this.queue || !this.isReady) return;
    try {
      const app = await this.applicationRepo.findOne({
        where: { id: applicationId },
        relations: { application_status: true },
      });

      const deadlineMs = app?.deadline_at ? new Date(app.deadline_at).getTime() : undefined;
      await this.cancelForApplication(applicationId, deadlineMs);

      if (!app || app.is_deleted || app.closed_at || !app.deadline_at || !deadlineMs) return;
      if (app.application_status && !app.application_status.tracks_sla) return;

      const { warnHours, urgentHours, escalateHours } =
        preloadedThresholds || (await this.loadSlaThresholds());

      const deadlineIso = new Date(app.deadline_at).toISOString();
      const nowMs = Date.now();

      const plan: Array<{ stage: SlaStage; fireAtMs: number }> = [];
      if (warnHours > 0) {
        plan.push({ stage: 'WARN_72H', fireAtMs: deadlineMs - warnHours * 3600 * 1000 });
      }
      if (urgentHours > 0 && urgentHours !== warnHours) {
        plan.push({ stage: 'URGENT_24H', fireAtMs: deadlineMs - urgentHours * 3600 * 1000 });
      }
      plan.push({ stage: 'OVERDUE_0H', fireAtMs: deadlineMs });
      if (escalateHours > 0) {
        plan.push({ stage: 'ESCALATE_24H', fireAtMs: deadlineMs + escalateHours * 3600 * 1000 });
      }

      for (const item of plan) {
        const delay = item.fireAtMs - nowMs;
        if (delay <= 0) continue; // O'tib ketgan bosqichlar uchun spam yubormaymiz
        await this.queue.add(
          item.stage,
          { applicationId, stage: item.stage, deadlineIso },
          {
            jobId: this.buildJobId(applicationId, item.stage, 'APPLICATION', deadlineMs),
            delay,
          },
        );
      }
    } catch (err) {
      this.logger.warn(
        `SLA job rejalashtirishda xato [${applicationId}]: ${(err as Error).message}`,
      );
    }
  }

  async reconcileAllOpenApplications(): Promise<{ scheduled: number; detectedCrimes: number }> {
    if (!this.queue || !this.isReady) return { scheduled: 0, detectedCrimes: 0 };
    try {
      const thresholds = await this.loadSlaThresholds();

      const [openApps, openCrimes] = await Promise.all([
        this.applicationRepo
          .createQueryBuilder('app')
          .leftJoinAndSelect('app.application_status', 'st')
          .where('app.is_deleted = false')
          .andWhere('app.closed_at IS NULL')
          .andWhere('app.deadline_at IS NOT NULL')
          .andWhere('(st.tracks_sla = true OR st.id IS NULL)')
          .select(['app.id', 'app.deadline_at', 'st.id', 'st.tracks_sla'])
          .getMany(),
        this.detectedCrimeRepo
          .createQueryBuilder('dc')
          .leftJoinAndSelect('dc.application_status', 'st')
          .where('dc.is_deleted = false')
          .andWhere('dc.closed_at IS NULL')
          .andWhere('dc.deadline_at IS NOT NULL')
          .andWhere('(st.tracks_sla = true OR st.id IS NULL)')
          .select(['dc.id', 'dc.deadline_at', 'st.id', 'st.tracks_sla'])
          .getMany(),
      ]);

      const CHUNK_SIZE = 10;
      let scheduled = 0;
      for (let i = 0; i < openApps.length; i += CHUNK_SIZE) {
        const chunk = openApps.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (app) => {
            await this.scheduleForApplication(app.id, thresholds);
            scheduled++;
          }),
        );
      }

      let detectedCrimes = 0;
      for (let i = 0; i < openCrimes.length; i += CHUNK_SIZE) {
        const chunk = openCrimes.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (dc) => {
            await this.scheduleForDetectedCrime(dc.id, thresholds);
            detectedCrimes++;
          }),
        );
      }

      this.logger.log(
        `BullMQ SLA sinxronizatsiyasi tugadi: ${scheduled} ta faol ariza, ${detectedCrimes} ta aniqlangan jinoyat`,
      );
      return { scheduled, detectedCrimes };
    } catch (err) {
      this.logger.warn(`SLA reconcile xatosi: ${(err as Error).message}`);
      return { scheduled: 0, detectedCrimes: 0 };
    }
  }

  async getQueueHealth(): Promise<{
    connected: boolean;
    delayed: number;
    waiting: number;
    active: number;
    failed: number;
  }> {
    if (!this.queue || !this.isReady) {
      return { connected: false, delayed: 0, waiting: 0, active: 0, failed: 0 };
    }
    try {
      const counts = await this.queue.getJobCounts('delayed', 'waiting', 'active', 'failed');
      return {
        connected: true,
        delayed: counts.delayed || 0,
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        failed: counts.failed || 0,
      };
    } catch {
      return { connected: false, delayed: 0, waiting: 0, active: 0, failed: 0 };
    }
  }

  private async processSlaJob(job: Job<SlaJobData>): Promise<void> {
    const { entityType = 'APPLICATION', applicationId, stage, deadlineIso } = job.data;

    if (entityType === 'DETECTED_CRIME') {
      const dc = await this.detectedCrimeRepo.findOne({
        where: { id: applicationId },
        relations: {
          district: true,
          application_status: true,
          created_by: true,
          detected_by: true,
        },
      });
      if (!dc || dc.is_deleted || dc.closed_at || !dc.deadline_at) return;
      if (dc.application_status && !dc.application_status.tracks_sla) return;
      if (new Date(dc.deadline_at).toISOString() !== deadlineIso) return;

      await this.notificationsService.dispatchDetectedCrimeSlaNotification(dc, stage);
      return;
    }

    const app = await this.applicationRepo.findOne({
      where: { id: applicationId },
      relations: {
        district: true,
        citizen: true,
        application_status: true,
        created_by: true,
      },
    });

    if (!app || app.is_deleted || app.closed_at || !app.deadline_at) return;
    if (app.application_status && !app.application_status.tracks_sla) return;

    // Agar ariza muddati o'zgargan bo'lsa, bu eskirgan job — o'tkazib yuboramiz
    const currentIso = new Date(app.deadline_at).toISOString();
    if (currentIso !== deadlineIso) return;

    await this.notificationsService.dispatchSlaStageNotification(app, stage);
  }
}
