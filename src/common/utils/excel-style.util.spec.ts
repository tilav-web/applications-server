import {
  escapeExcelCriteriaLiteral,
  sanitizeExcelRow,
  sanitizeExcelValue,
} from './excel-style.util';

describe('excel-style.util', () => {
  it('prefixes formula injection payloads with a single quote', () => {
    expect(sanitizeExcelValue('=CMD|" /C calc"!A0')).toBe('\'=CMD|" /C calc"!A0');
    expect(sanitizeExcelValue('+998901234567')).toBe("'+998901234567");
    expect(sanitizeExcelValue('-2+3')).toBe("'-2+3");
    expect(sanitizeExcelValue('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
    expect(sanitizeExcelValue('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeExcelValue('  =HYPERLINK("http://evil")')).toBe('\'  =HYPERLINK("http://evil")');
  });

  it('leaves benign strings and non-strings untouched', () => {
    expect(sanitizeExcelValue('Qarshi sh.')).toBe('Qarshi sh.');
    expect(sanitizeExcelValue('2026-0001')).toBe('2026-0001');
    expect(sanitizeExcelValue('')).toBe('');
    expect(sanitizeExcelValue(12345)).toBe(12345);
    expect(sanitizeExcelValue(null)).toBeNull();
  });

  it('sanitizes string fields in row objects while preserving ExcelJS formula objects', () => {
    const formulaObj = { formula: 'SUM(A2:A10)' };
    const row = sanitizeExcelRow({
      name: '=IMPORTXML("http://x","//a")',
      phone: '+998901112233',
      amount: 500000,
      total: formulaObj,
    });

    expect(row.name).toBe('\'=IMPORTXML("http://x","//a")');
    expect(row.phone).toBe("'+998901112233");
    expect(row.amount).toBe(500000);
    expect(row.total).toBe(formulaObj);
  });

  it('escapes Excel wildcard and quote characters in criteria literals', () => {
    expect(escapeExcelCriteriaLiteral('A*B?C~"D"')).toBe('A~*B~?C~~""D""');
  });
});
