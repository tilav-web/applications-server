import {
  AppealType,
  ApplicationRepeatType,
  SubmissionForm,
} from '../../../common/enums/appeal-classification.enum';
import { ApplicationDamageType } from '../../../common/enums/damage-type.enum';
import type { Application } from '../application.entity';
import type { Transfer } from '../transfers/transfer.entity';
import { ApplicationsExcelService } from './applications-excel.service';

describe('ApplicationsExcelService', () => {
  let service: ApplicationsExcelService;

  beforeEach(() => {
    service = new ApplicationsExcelService();
  });

  it('builds all 5 worksheets, deduplicates transfers, sanitizes formulas, and includes non-card damages in Summary KPI', async () => {
    const apps: Partial<Application>[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        application_number: '2026-00001',
        date: new Date('2026-11-20T00:00:00.000Z'),
        created_at: new Date('2026-11-20T00:00:00.000Z'),
        status: 'JARAYONDA',
        application_status: { name: 'Tergovda' } as never,
        district: { name: 'Qarshi sh.' } as never,
        citizen: {
          full_name: '=CMD|calc Ali',
          gender: 'male',
          phone_number: '998901234567',
        } as never,
        appeal_type: AppealType.APPEAL,
        submission_form: SubmissionForm.ELECTRONIC,
        repeat_type: ApplicationRepeatType.PRIMARY,
        crime_method: {
          name: 'Telegram',
          fields: [{ key: 'method_bot', label: 'Bot nomi', is_active: true, show_in_excel: true }],
        } as never,
        transfer: {
          id: 'tr-1',
          amount: 1_000_000,
          currency: 'UZS',
          sender_card: { card_number: '8600111122223333', bank: { name: 'Agrobank' } },
          receiver_card: { card_number: '9860444455556666', full_name: 'Firibgar' },
          payment_provider: { name: 'Click' },
        } as never,
        custom_fields: [
          { key: 'method_bot', value: '@scam_bot' },
          // Duplicate tr-1 must NOT be listed twice in Transfers sheet!
          { transfer: { id: 'tr-1', amount: 1_000_000, currency: 'UZS' } },
        ] as never,
        damages: [
          {
            damage_type: ApplicationDamageType.ONLINE_CREDIT,
            organization_name: 'TBC Bank',
            amount: 5_000_000,
            currency: 'UZS',
          },
        ] as never,
        suspect_tree: [
          {
            label: 'Telegram',
            value: '@fraud_1',
            children: [{ label: 'Telefon', value: '+998901112233' }],
          },
        ] as never,
      },
    ];

    const extraTransfersMap = new Map<string, Transfer[]>([
      [
        '11111111-1111-4111-8111-111111111111',
        [
          { id: 'tr-1', amount: 1_000_000, currency: 'UZS' } as Transfer, // dup -> skipped
          {
            id: 'tr-2',
            amount: 500_000,
            currency: 'UZS',
            destination_type: 'CRYPTO',
            destination_label: 'Binance: TXYZ',
          } as Transfer,
        ],
      ],
    ]);

    const wb = await service.generateWorkbook(apps as Application[], extraTransfersMap);

    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Arizalar ro'yxati",
      "Pul o'tkazmalari",
      'Kartasiz zararlar',
      'Gumonlanuvchilar',
      'Xulosa va Statistika',
    ]);

    // Sheet 1: formula injection sanitized (leading '=' and '@' prefixed with "'") + dynamic column populated
    const wsApps = wb.getWorksheet("Arizalar ro'yxati")!;
    expect(wsApps.getRow(2).getCell('citizen_name').value).toBe("'=CMD|calc Ali");
    expect(wsApps.getRow(2).getCell('dyn_method_bot').value).toBe("'@scam_bot");

    // Sheet 2: 2 unique transfers (tr-1 deduplicated) + header + 3 footer rows = 6 rows
    const wsTr = wb.getWorksheet("Pul o'tkazmalari")!;
    expect(wsTr.rowCount).toBe(6);
    expect(wsTr.getRow(3).getCell('receiver_card').value).toBe('Binance: TXYZ');

    // Sheet 3: 1 damage row + header + 1 total row = 3 rows
    const wsDmg = wb.getWorksheet('Kartasiz zararlar')!;
    expect(wsDmg.rowCount).toBe(3);

    // Sheet 4: 2 flattened suspect tree nodes (parent + child) + header + total = 4 rows
    const wsSusp = wb.getWorksheet('Gumonlanuvchilar')!;
    expect(wsSusp.rowCount).toBe(4);

    // Sheet 5: Summary KPI MUST include BOTH Pul o'tkazmalari AND Kartasiz zararlar!
    const wsSummary = wb.getWorksheet('Xulosa va Statistika')!;
    const totalLossFormula = (wsSummary.getRow(8).getCell(3).value as { formula: string }).formula;
    expect(totalLossFormula).toContain("SUMIF('Pul o''tkazmalari'");
    expect(totalLossFormula).toContain("SUMIF('Kartasiz zararlar'");
  });

  it('handles empty applications array cleanly without broken formulas', async () => {
    const wb = await service.generateWorkbook([]);
    expect(wb.worksheets).toHaveLength(5);
    expect(wb.getWorksheet("Arizalar ro'yxati")!.rowCount).toBe(1);
    expect(wb.getWorksheet('Kartasiz zararlar')!.rowCount).toBe(1);
  });
});
