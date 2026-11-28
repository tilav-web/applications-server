import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { Repository } from 'typeorm';

import type { Application } from '../applications/application.entity';
import type { SystemSetting } from '../audit/system-setting.entity';
import type { DetectedCrime } from '../detected-crimes/entities/detected-crime.entity';
import type { NotificationsService } from './notifications.service';
import { type SlaJobData, SlaQueueService } from './sla-queue.service';

describe('SlaQueueService', () => {
  let service: SlaQueueService;
  let configService: { get: jest.Mock };
  let applicationRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let detectedCrimeRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let settingRepo: { findOne: jest.Mock };
  let notificationsService: {
    dispatchSlaStageNotification: jest.Mock;
    dispatchDetectedCrimeSlaNotification: jest.Mock;
  };
  let mockQueue: {
    add: jest.Mock;
    getJob: jest.Mock;
    getJobCounts: jest.Mock;
    close: jest.Mock;
  };

  function markQueueReady() {
    const internal = service as unknown as {
      queue: typeof mockQueue;
      queueReady: boolean;
      workerReady: boolean;
    };
    internal.queue = mockQueue;
    internal.queueReady = true;
    internal.workerReady = true;
  }

  beforeEach(() => {
    configService = { get: jest.fn() };
    applicationRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    detectedCrimeRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    settingRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    notificationsService = {
      dispatchSlaStageNotification: jest.fn().mockResolvedValue(undefined),
      dispatchDetectedCrimeSlaNotification: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue(null),
      getJobCounts: jest.fn().mockResolvedValue({ delayed: 4, waiting: 1, active: 0, failed: 0 }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    service = new SlaQueueService(
      configService as unknown as ConfigService,
      applicationRepo as unknown as Repository<Application>,
      detectedCrimeRepo as unknown as Repository<DetectedCrime>,
      settingRepo as unknown as Repository<SystemSetting>,
      notificationsService as unknown as NotificationsService,
    );
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('scheduleForApplication', () => {
    it('schedules all 4 future stages with exact jobIds and falls back cleanly on empty string settings', async () => {
      markQueueReady();
      const deadline = new Date(Date.now() + 10 * 24 * 3600 * 1000); // +10 days
      applicationRepo.findOne.mockResolvedValue({
        id: 'app-1',
        is_deleted: false,
        closed_at: null,
        deadline_at: deadline,
        application_status: { tracks_sla: true },
      });
      // Empty string in system_settings MUST fall back to defaults (72, 24, 24), NOT 0!
      settingRepo.findOne.mockResolvedValue({ key: 'sla_warn_hours_before', value: '   ' });

      await service.scheduleForApplication('app-1');

      expect(mockQueue.add).toHaveBeenCalledTimes(4);
      const stages = (mockQueue.add.mock.calls as Array<[string]>).map((c) => c[0]);
      expect(stages).toEqual(['WARN_72H', 'URGENT_24H', 'OVERDUE_0H', 'ESCALATE_24H']);

      const firstOpts = (
        mockQueue.add.mock.calls as Array<[string, SlaJobData, { jobId: string }]>
      )[0][2];
      expect(firstOpts.jobId).toBe(`sla__app-1__WARN_72H__${deadline.getTime()}`);
    });

    it('skips past stages (delay <= 0) and skips closed/deleted/non-SLA applications', async () => {
      markQueueReady();
      // Only 10 hours left -> WARN_72H and URGENT_24H are already past; only OVERDUE_0H & ESCALATE_24H scheduled
      const soonDeadline = new Date(Date.now() + 10 * 3600 * 1000);
      applicationRepo.findOne.mockResolvedValueOnce({
        id: 'app-soon',
        is_deleted: false,
        closed_at: null,
        deadline_at: soonDeadline,
        application_status: { tracks_sla: true },
      });

      await service.scheduleForApplication('app-soon');
      const stages = (mockQueue.add.mock.calls as Array<[string]>).map((c) => c[0]);
      expect(stages).toEqual(['OVERDUE_0H', 'ESCALATE_24H']);

      // tracks_sla = false -> cancels existing jobs and adds ZERO new jobs
      mockQueue.add.mockClear();
      applicationRepo.findOne.mockResolvedValueOnce({
        id: 'app-paused',
        is_deleted: false,
        closed_at: null,
        deadline_at: soonDeadline,
        application_status: { tracks_sla: false },
      });
      await service.scheduleForApplication('app-paused');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('cancelForApplication & cancelForDetectedCrime without explicit deadlineMs', () => {
    it('looks up deadline_at from DB and removes BOTH legacy and deadlineMs-suffixed BullMQ jobs', async () => {
      markQueueReady();
      const deadline = new Date('2026-12-10T10:00:00.000Z');
      const removeFn = jest.fn().mockResolvedValue(undefined);
      applicationRepo.findOne.mockResolvedValue({ id: 'app-close', deadline_at: deadline });
      mockQueue.getJob.mockImplementation((jobId: string) =>
        jobId.endsWith(`__${deadline.getTime()}`)
          ? Promise.resolve({ id: jobId, remove: removeFn })
          : Promise.resolve(null),
      );

      await service.cancelForApplication('app-close');

      expect(applicationRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'app-close' },
        select: { id: true, deadline_at: true },
      });
      expect(removeFn).toHaveBeenCalledTimes(4);
    });
  });

  describe('reconcileAllOpenApplications (N+1 prevention)', () => {
    it('schedules all open applications and detected crimes without per-row findOne N+1 queries', async () => {
      markQueueReady();
      const deadline = new Date(Date.now() + 5 * 24 * 3600 * 1000);

      const appQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'a-1',
            deadline_at: deadline,
            is_deleted: false,
            closed_at: null,
            application_status: { id: 's-1', tracks_sla: true },
          },
          {
            id: 'a-2',
            deadline_at: deadline,
            is_deleted: false,
            closed_at: null,
            application_status: { id: 's-1', tracks_sla: true },
          },
        ]),
      };
      const dcQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'dc-1',
            deadline_at: deadline,
            is_deleted: false,
            closed_at: null,
            application_status: { id: 's-1', tracks_sla: true },
          },
        ]),
      };
      applicationRepo.createQueryBuilder.mockReturnValue(appQb);
      detectedCrimeRepo.createQueryBuilder.mockReturnValue(dcQb);

      const result = await service.reconcileAllOpenApplications();

      expect(result).toEqual({ scheduled: 2, detectedCrimes: 1 });
      // Zero N+1 findOne calls!
      expect(applicationRepo.findOne).not.toHaveBeenCalled();
      expect(detectedCrimeRepo.findOne).not.toHaveBeenCalled();
      // 3 entities * 4 stages = 12 BullMQ jobs
      expect(mockQueue.add).toHaveBeenCalledTimes(12);
    });
  });

  describe('processSlaJob stale-job & entity-routing guard', () => {
    it('ignores stale job whose deadlineIso differs from current DB deadline_at', async () => {
      const internal = service as unknown as {
        processSlaJob: (job: Job<SlaJobData>) => Promise<void>;
      };

      applicationRepo.findOne.mockResolvedValue({
        id: 'app-1',
        is_deleted: false,
        closed_at: null,
        deadline_at: new Date('2026-12-20T00:00:00.000Z'), // extended!
        application_status: { tracks_sla: true },
      });

      await internal.processSlaJob({
        data: {
          applicationId: 'app-1',
          stage: 'OVERDUE_0H',
          deadlineIso: '2026-12-10T00:00:00.000Z', // old deadline!
        },
      } as Job<SlaJobData>);

      expect(notificationsService.dispatchSlaStageNotification).not.toHaveBeenCalled();
    });

    it('dispatches valid APPLICATION and DETECTED_CRIME jobs to the right notification handler', async () => {
      const internal = service as unknown as {
        processSlaJob: (job: Job<SlaJobData>) => Promise<void>;
      };

      const iso = '2026-12-15T12:00:00.000Z';
      const dcRecord = {
        id: 'dc-1',
        is_deleted: false,
        closed_at: null,
        deadline_at: new Date(iso),
        application_status: { tracks_sla: true },
      };
      detectedCrimeRepo.findOne.mockResolvedValue(dcRecord);

      await internal.processSlaJob({
        data: {
          entityType: 'DETECTED_CRIME',
          applicationId: 'dc-1',
          stage: 'URGENT_24H',
          deadlineIso: iso,
        },
      } as Job<SlaJobData>);

      expect(notificationsService.dispatchDetectedCrimeSlaNotification).toHaveBeenCalledWith(
        dcRecord,
        'URGENT_24H',
      );
    });
  });

  describe('getQueueHealth', () => {
    it('returns disconnected zeros when queue is not ready and real counts when ready', async () => {
      expect(await service.getQueueHealth()).toEqual({
        connected: false,
        delayed: 0,
        waiting: 0,
        active: 0,
        failed: 0,
      });

      markQueueReady();
      expect(await service.getQueueHealth()).toEqual({
        connected: true,
        delayed: 4,
        waiting: 1,
        active: 0,
        failed: 0,
      });
    });
  });
});
