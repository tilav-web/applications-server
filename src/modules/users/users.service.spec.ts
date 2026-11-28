import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';

import { Role } from '../../common/enums/role.enum';
import type { JwtAccessPayload } from '../../common/types/jwt-payload.interface';
import type { District } from '../applications/districts/district.entity';
import type { Auth } from '../auth/auth.entity';
import type { AuthService } from '../auth/auth.service';
import type { User } from './user.entity';
import { UsersService } from './users.service';

const ROOT_ACTOR: JwtAccessPayload = {
  sub: 'root-auth-id',
  username: 'root_admin',
  role: Role.SUPER_ADMIN,
};

const NON_ROOT_ADMIN: JwtAccessPayload = {
  sub: 'admin-auth-id',
  username: 'admin2',
  role: Role.SUPER_ADMIN,
};

function createMockQb(items: unknown[] = [], total = 0) {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([items, total]),
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let authRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let districtRepo: { findBy: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let authService: { revokeUserTokens: jest.Mock; invalidateProfileCache: jest.Mock };

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
    };
    authRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
      remove: jest.fn((v: unknown) => Promise.resolve(v)),
      createQueryBuilder: jest.fn(),
    };
    districtRepo = {
      findBy: jest.fn().mockResolvedValue([]),
    };
    dataSource = {
      transaction: jest.fn(),
    };
    authService = {
      revokeUserTokens: jest.fn().mockResolvedValue(undefined),
      invalidateProfileCache: jest.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(
      userRepo as unknown as Repository<User>,
      authRepo as unknown as Repository<Auth>,
      districtRepo as unknown as Repository<District>,
      dataSource as unknown as DataSource,
      authService as unknown as AuthService,
    );
  });

  describe('Root Super Admin enforcement', () => {
    it('blocks missing caller, non-SUPER_ADMIN, and non-root SUPER_ADMIN verified from DB', async () => {
      await expect(service.findAll(1, 10, undefined, undefined, undefined)).rejects.toThrow(
        ForbiddenException,
      );

      // Even if JWT claims SUPER_ADMIN, DB is_root=false MUST be rejected
      authRepo.findOne.mockResolvedValueOnce({
        id: 'admin-auth-id',
        role: Role.SUPER_ADMIN,
        is_root: false,
      });
      await expect(service.findAll(1, 10, undefined, undefined, NON_ROOT_ADMIN)).rejects.toThrow(
        ForbiddenException,
      );

      authRepo.findOne.mockResolvedValueOnce({
        id: 'staff-id',
        role: Role.ADMIN,
        is_root: true,
      });
      await expect(
        service.findOne('u-1', { sub: 'staff-id', username: 's', role: Role.ADMIN }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('clamps invalid pagination and escapes LIKE wildcards across all search filters', async () => {
      authRepo.findOne.mockResolvedValue({
        id: ROOT_ACTOR.sub,
        role: Role.SUPER_ADMIN,
        is_root: true,
      });
      const qb = createMockQb([], 0);
      authRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.findAll(
        -5,
        9999,
        '100%_test\\x',
        {
          fullName: 'Ali_%',
          username: '@user_1%',
          phoneNumber: '90_123%',
        },
        ROOT_ACTOR,
      );

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(100);
      expect(res.meta).toEqual({
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const andWhereCalls = qb.andWhere.mock.calls as Array<[string, Record<string, string>]>;
      const allParamValues = andWhereCalls.map((c) => Object.values(c[1])[0]);
      expect(allParamValues).toContain('%Ali\\_\\%%');
      expect(allParamValues).toContain('%user\\_1\\%%');
      expect(allParamValues).toContain('%100\\%\\_test\\\\x%');
    });
  });

  describe('create', () => {
    beforeEach(() => {
      authRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ACTOR.sub,
        role: Role.SUPER_ADMIN,
        is_root: true,
      });
    });

    it('rejects blank/whitespace-only username', async () => {
      await expect(
        service.create({ username: '   ', password: 'Secret123!', role: Role.STAFF }, ROOT_ACTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate username and maps concurrent PG 23505 unique violation to BadRequestException', async () => {
      authRepo.findOne.mockResolvedValueOnce(null); // pre-check misses concurrent insert
      dataSource.transaction.mockRejectedValueOnce({ code: '23505' });

      await expect(
        service.create(
          { username: ' officer_1 ', password: 'Secret123!', role: Role.DISTRICT_OFFICER },
          ROOT_ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates auth (is_root=false, trimmed username) and user profile atomically in transaction', async () => {
      authRepo.findOne
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce({
          id: 'new-auth-1',
          username: 'officer_1',
          role: Role.DISTRICT_OFFICER,
          is_root: false,
          created_at: new Date(),
          updated_at: new Date(),
          user: {
            first_name: 'Vali',
            last_name: 'Aliyev',
            phone_number: '+998901112233',
            assigned_districts: [{ id: 'd-1', name: 'Qarshi sh.' }],
          },
        });

      const txAuthRepo = {
        create: jest.fn((v: Record<string, unknown>) => v),
        save: jest.fn((v: Record<string, unknown>) => Promise.resolve({ id: 'new-auth-1', ...v })),
      };
      const txUserRepo = {
        create: jest.fn((v: Record<string, unknown>) => v),
        save: jest.fn((v: Record<string, unknown>) => Promise.resolve(v)),
      };
      const txDistrictRepo = {
        findBy: jest.fn().mockResolvedValue([{ id: 'd-1', name: 'Qarshi sh.' }]),
      };

      dataSource.transaction.mockImplementation(
        (cb: (mgr: { getRepository: (e: unknown) => unknown }) => Promise<string>) =>
          cb({
            getRepository: (entity: { name?: string }) => {
              if (entity.name === 'Auth') return txAuthRepo;
              if (entity.name === 'User') return txUserRepo;
              return txDistrictRepo;
            },
          }),
      );

      const created = await service.create(
        {
          username: '  officer_1  ',
          password: 'Password123!',
          role: Role.DISTRICT_OFFICER,
          first_name: 'Vali',
          last_name: 'Aliyev',
          assigned_district_ids: ['d-1'],
        },
        ROOT_ACTOR,
      );

      expect(txAuthRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'officer_1',
          role: Role.DISTRICT_OFFICER,
          is_root: false,
        }),
      );
      const createdAuthArg = (txAuthRepo.create.mock.calls as Array<[{ password: string }]>)[0][0];
      expect(createdAuthArg.password).not.toBe('Password123!'); // hashed
      expect(created.assigned_districts).toEqual([{ id: 'd-1', name: 'Qarshi sh.' }]);
    });
  });

  describe('update', () => {
    it('prevents editing root account by another user and prevents demoting root role', async () => {
      authRepo.findOne
        .mockResolvedValueOnce({ id: 'other-root', role: Role.SUPER_ADMIN, is_root: true })
        .mockResolvedValueOnce({
          id: ROOT_ACTOR.sub,
          username: 'root_admin',
          role: Role.SUPER_ADMIN,
          is_root: true,
        });

      await expect(
        service.update(
          ROOT_ACTOR.sub,
          { first_name: 'Hijack' },
          { sub: 'other-root', username: 'r2', role: Role.SUPER_ADMIN },
        ),
      ).rejects.toThrow(ForbiddenException);

      authRepo.findOne
        .mockResolvedValueOnce({ id: ROOT_ACTOR.sub, role: Role.SUPER_ADMIN, is_root: true })
        .mockResolvedValueOnce({
          id: ROOT_ACTOR.sub,
          username: 'root_admin',
          role: Role.SUPER_ADMIN,
          is_root: true,
        });

      await expect(
        service.update(ROOT_ACTOR.sub, { role: Role.STAFF }, ROOT_ACTOR),
      ).rejects.toThrow(ForbiddenException);
    });

    it('revokes tokens when role/password/username changes, but only invalidates cache on profile-only edit', async () => {
      const targetAuth = {
        id: 'u-2',
        username: 'staff1',
        role: Role.STAFF,
        is_root: false,
        hashed_refresh_token: 'hash',
        created_at: new Date(),
        updated_at: new Date(),
        user: { id: 'p-2', auth_id: 'u-2', first_name: 'Old', assigned_districts: [] },
      };

      // Profile-only edit
      authRepo.findOne
        .mockResolvedValueOnce({ id: ROOT_ACTOR.sub, role: Role.SUPER_ADMIN, is_root: true })
        .mockResolvedValueOnce({ ...targetAuth })
        .mockResolvedValueOnce({ ...targetAuth });

      await service.update('u-2', { first_name: 'NewName' }, ROOT_ACTOR);
      expect(authService.invalidateProfileCache).toHaveBeenCalledWith('u-2');
      expect(authService.revokeUserTokens).not.toHaveBeenCalled();

      // Role change -> must revoke active tokens & clear refresh token
      authService.invalidateProfileCache.mockClear();
      const targetForRole = { ...targetAuth, hashed_refresh_token: 'hash' };
      authRepo.findOne
        .mockResolvedValueOnce({ id: ROOT_ACTOR.sub, role: Role.SUPER_ADMIN, is_root: true })
        .mockResolvedValueOnce(targetForRole)
        .mockResolvedValueOnce(targetForRole);

      await service.update('u-2', { role: Role.ADMIN }, ROOT_ACTOR);
      expect(targetForRole.hashed_refresh_token).toBeNull();
      expect(authService.revokeUserTokens).toHaveBeenCalledWith('u-2');
    });
  });

  describe('remove & getStats', () => {
    it('forbids deleting root account or self, and revokes tokens when removing regular user', async () => {
      authRepo.findOne
        .mockResolvedValueOnce({ id: ROOT_ACTOR.sub, role: Role.SUPER_ADMIN, is_root: true })
        .mockResolvedValueOnce({ id: 'root-2', is_root: true });
      await expect(service.remove('root-2', ROOT_ACTOR)).rejects.toThrow(ForbiddenException);

      authRepo.findOne
        .mockResolvedValueOnce({ id: ROOT_ACTOR.sub, role: Role.SUPER_ADMIN, is_root: true })
        .mockResolvedValueOnce(null);
      await expect(service.remove('missing-id', ROOT_ACTOR)).rejects.toThrow(NotFoundException);

      const regular = { id: 'u-9', is_root: false };
      authRepo.findOne
        .mockResolvedValueOnce({ id: ROOT_ACTOR.sub, role: Role.SUPER_ADMIN, is_root: true })
        .mockResolvedValueOnce(regular);
      const res = await service.remove('u-9', ROOT_ACTOR);
      expect(res.success).toBe(true);
      expect(authRepo.remove).toHaveBeenCalledWith(regular);
      expect(authService.revokeUserTokens).toHaveBeenCalledWith('u-9');
    });

    it('computes user statistics accurately by role, root count, and assigned districts', async () => {
      authRepo.findOne.mockResolvedValueOnce({
        id: ROOT_ACTOR.sub,
        role: Role.SUPER_ADMIN,
        is_root: true,
      });
      authRepo.find.mockResolvedValueOnce([
        { role: Role.SUPER_ADMIN, is_root: true, user: { assigned_districts: [] } },
        {
          role: Role.DISTRICT_OFFICER,
          is_root: false,
          user: { assigned_districts: [{ id: 'd-1' }] },
        },
        {
          role: Role.DISTRICT_OFFICER,
          is_root: false,
          user: { assigned_districts: [{ id: 'd-2' }] },
        },
        { role: Role.BOSS, is_root: false, user: null },
      ]);

      const stats = await service.getStats(ROOT_ACTOR);
      expect(stats.total).toBe(4);
      expect(stats.rootCount).toBe(1);
      expect(stats.withDistrictsCount).toBe(2);
      expect(stats.byRole[0]).toEqual({ role: Role.DISTRICT_OFFICER, count: 2, percent: 50 });
    });
  });
});
