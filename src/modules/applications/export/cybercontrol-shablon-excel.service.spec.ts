import type { Application } from '../application.entity';
import { ApplicationStatusCategory } from '../statuses/application-status.entity';
import type { Transfer } from '../transfers/transfer.entity';
import { CyberControlShablonExcelService } from './cybercontrol-shablon-excel.service';

describe('CyberControlShablonExcelService', () => {
  let service: CyberControlShablonExcelService;

  beforeEach(() => {
    service = new CyberControlShablonExcelService();
  });

  it('generates workbook from murojaat_shablon.xlsx, clears dummy row, sanitizes cells, resolves PINFL age/gender, OPEN status, and UZS-only loss', async () => {
    const app: Partial<Application> = {
      id: 'app-1',
      date: new Date('2026-11-20T00:00:00.000Z'),
      created_at: new Date('2026-11-20T00:00:00.000Z'),
      district: { name: 'Qarshi shahri' } as never,
      citizen: {
        full_name: '=CMD|calc Karimova Malika',
        // Century digit 4 -> 1900s female, born 15.05.1995 -> age 31 in Nov 2026
        pinfl: '41505950010022',
        phone_number: '90 123-45-67',
        district: { name: 'Qarshi shahri' },
        workplace: { name: 'Qarshi Davlat Universiteti' },
        work_position: '3-kurs talabasi',
      } as never,
      workplace: { name: 'Qarshi Davlat Universiteti' } as never,
      work_position: '3-kurs talabasi',
      application_status: {
        name: 'Custom Open',
        code: 'CUSTOM_INIT',
        category: ApplicationStatusCategory.OPEN,
      } as never,
      description: 'Telegram orqali soxta havola va zararli APK yuborib pul yechib oldi',
      suspect_tree: [{ label: 'Telegram', value: '@fraudster_1' }] as never,
      transfer: { id: 'tr-1', amount: 1_200_000, currency: 'UZS' } as never,
      damages: [
        { amount: 800_000, currency: 'UZS' },
        { amount: 500, currency: 'USD' }, // must NOT mix USD into UZS loss!
      ] as never,
    };

    const extraTransfers = new Map<string, Transfer[]>([
      [
        'app-1',
        [
          { id: 'tr-1', amount: 1_200_000, currency: 'UZS' } as Transfer, // dup -> skipped
          { id: 'tr-usd', amount: 100, currency: 'USD' } as Transfer, // USD -> skipped
        ],
      ],
    ]);

    const wb = await service.generateWorkbook([app as Application], extraTransfers);
    const sheet = wb.getWorksheet('Import') ?? wb.worksheets[0];

    // Row 2 has our mapped application
    expect(sheet.getCell(2, 1).value).toBe('2026-11-20'); // Sana
    expect(sheet.getCell(2, 3).text).toMatch(/Қарши\s*ш|Qarshi\s*sh/i); // Qarshi sh (NOT tuman!)
    expect(sheet.getCell(2, 5).value).toBe("'=CMD|calc Karimova Malika"); // Formula injection escaped
    expect(sheet.getCell(2, 6).value).toBe('Ayol'); // Gender from PINFL digit 4
    expect(sheet.getCell(2, 7).value).toBe(31); // Age from PINFL 15.05.1995
    expect(sheet.getCell(2, 8).value).toBe("'+998901234567"); // Phone formatted & formula-escaped (+)
    expect(sheet.getCell(2, 12).value).toBe('Qarshi Davlat Universiteti'); // Education workplace
    expect(sheet.getCell(2, 13).value).toBe(3); // 3-kurs
    expect(sheet.getCell(2, 14).text).toMatch(/telegram/i); // Social network
    expect(sheet.getCell(2, 15).value).toBe(2_000_000); // 1_200_000 + 800_000 UZS only (USD excluded!)
    expect(sheet.getCell(2, 16).text).not.toBe(''); // OPEN status resolved
  });

  it('clears template dummy row 2 even when applications array is empty', async () => {
    const wb = await service.generateWorkbook([]);
    const sheet = wb.getWorksheet('Import') ?? wb.worksheets[0];
    expect(sheet.getCell(2, 2).value).toBeNull();
    expect(sheet.getCell(2, 5).value).toBeNull();
  });
});
