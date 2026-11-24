import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { User } from '../../modules/users/user.entity';
import { Role } from '../enums/role.enum';
import type { JwtAccessPayload } from '../types/jwt-payload.interface';
import {
  assertDistrictAccess,
  getAllowedDistrictIds,
  maskCardNumberForAlert,
} from './district-scope.util';

describe('district-scope.util', () => {
  it('returns null (unrestricted) for non-DISTRICT_OFFICER roles', async () => {
    const findOne = jest.fn();
    const mockRepo = { findOne } as unknown as Repository<User>;
    const admin: JwtAccessPayload = {
      sub: 'auth-1',
      username: 'admin',
      role: Role.ADMIN,
      is_root: false,
    };
    const boss: JwtAccessPayload = {
      sub: 'auth-2',
      username: 'boss',
      role: Role.BOSS,
      is_root: false,
    };

    expect(await getAllowedDistrictIds(mockRepo, admin)).toBeNull();
    expect(await getAllowedDistrictIds(mockRepo, boss)).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns assigned district IDs for DISTRICT_OFFICER (fail-closed empty array if none)', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({ assigned_districts: [{ id: 'd-1' }, { id: 'd-2' }] })
      .mockResolvedValueOnce(null);
    const mockRepo = { findOne } as unknown as Repository<User>;
    const officer: JwtAccessPayload = {
      sub: 'auth-3',
      username: 'officer',
      role: Role.DISTRICT_OFFICER,
      is_root: false,
    };

    expect(await getAllowedDistrictIds(mockRepo, officer)).toEqual(['d-1', 'd-2']);
    expect(await getAllowedDistrictIds(mockRepo, officer)).toEqual([]);
  });

  it('enforces fail-closed district access checks', () => {
    expect(() => assertDistrictAccess(null, null)).not.toThrow();
    expect(() => assertDistrictAccess(['d-1', 'd-2'], 'd-1')).not.toThrow();
    expect(() => assertDistrictAccess(['d-1'], 'd-2')).toThrow(ForbiddenException);
    expect(() => assertDistrictAccess(['d-1'], null)).toThrow(ForbiddenException);
    expect(() => assertDistrictAccess([], 'd-1')).toThrow(ForbiddenException);
  });

  it('masks 16-digit card numbers for external alerts', () => {
    expect(maskCardNumberForAlert('8600 1234 5678 9012')).toBe('8600 **** **** 9012');
    expect(maskCardNumberForAlert(null)).toBe('Karta');
  });
});
