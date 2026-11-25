import { BadRequestException } from '@nestjs/common';

import { ApplicationRepeatType } from '../../common/enums/appeal-classification.enum';
import {
  assertNoChainCycle,
  computeNextRepeatSequence,
  resolveRootApplicationId,
  shouldIncludeInDamageTotal,
} from './application-chain.util';

describe('application-chain.util', () => {
  it('resolves root application id from primary parent and chained repeat parent', () => {
    const primary = { id: 'app-1', root_application_id: null };
    expect(resolveRootApplicationId(primary)).toBe('app-1');

    const repeat1 = { id: 'app-2', parent_application_id: 'app-1', root_application_id: 'app-1' };
    expect(resolveRootApplicationId(repeat1)).toBe('app-1');
  });

  it('computes monotonically increasing repeat sequences for unlimited chains', () => {
    expect(computeNextRepeatSequence(0)).toBe(2);
    expect(computeNextRepeatSequence(1)).toBe(2);
    expect(computeNextRepeatSequence(2)).toBe(3);
    expect(computeNextRepeatSequence(5)).toBe(6);
  });

  it('blocks self-reference and ancestor cycles', () => {
    expect(() => assertNoChainCycle('app-1', 'app-1', new Set())).toThrow(BadRequestException);
    expect(() => assertNoChainCycle('app-1', 'app-3', new Set(['app-2', 'app-1']))).toThrow(
      BadRequestException,
    );
    expect(() => assertNoChainCycle('app-4', 'app-3', new Set(['app-2', 'app-1']))).not.toThrow();
  });

  it('excludes DUPLICATE appeals from damage totals to prevent double-counting', () => {
    expect(shouldIncludeInDamageTotal(ApplicationRepeatType.PRIMARY)).toBe(true);
    expect(shouldIncludeInDamageTotal(ApplicationRepeatType.SUPPLEMENTAL)).toBe(true);
    expect(shouldIncludeInDamageTotal(ApplicationRepeatType.REPEAT)).toBe(true);
    expect(shouldIncludeInDamageTotal(ApplicationRepeatType.DUPLICATE)).toBe(false);
    expect(shouldIncludeInDamageTotal(null)).toBe(true);
  });
});
