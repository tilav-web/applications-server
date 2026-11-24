import {
  escapeLikePattern,
  isPgUniqueViolation,
  normalizeCardNumber,
  normalizePassport,
  normalizePinfl,
  normalizeUzPhone,
} from './normalization.util';

describe('normalization.util', () => {
  it('normalizes passport numbers by stripping spaces/hyphens and uppercasing', () => {
    expect(normalizePassport(' ab 123-4567 ')).toBe('AB1234567');
    expect(normalizePassport('aa1234567')).toBe('AA1234567');
    expect(normalizePassport('   ')).toBeNull();
    expect(normalizePassport(null)).toBeNull();
  });

  it('normalizes PINFL to digits only', () => {
    expect(normalizePinfl('3 120595 123 0014')).toBe('31205951230014');
    expect(normalizePinfl('abc')).toBeNull();
    expect(normalizePinfl(undefined)).toBeNull();
  });

  it('normalizes Uzbekistan 9-digit and 12-digit phone numbers consistently', () => {
    expect(normalizeUzPhone('90 123-45-67')).toBe('998901234567');
    expect(normalizeUzPhone('+998 (90) 123 45 67')).toBe('998901234567');
    expect(normalizeUzPhone('+7 999 123 45 67')).toBe('79991234567');
    expect(normalizeUzPhone('')).toBeNull();
  });

  it('normalizes card numbers to digits only', () => {
    expect(normalizeCardNumber('8600 1234-5678 9012')).toBe('8600123456789012');
    expect(normalizeCardNumber('----')).toBeNull();
  });

  it('escapes LIKE/ILIKE wildcard characters safely', () => {
    expect(escapeLikePattern('100%_test\\path')).toBe('100\\%\\_test\\\\path');
  });

  it('detects PostgreSQL unique_violation error code 23505', () => {
    expect(isPgUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPgUniqueViolation({ driverError: { code: '23505' } })).toBe(true);
    expect(isPgUniqueViolation({ code: '22P02' })).toBe(false);
    expect(isPgUniqueViolation(null)).toBe(false);
  });
});
