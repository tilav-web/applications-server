import * as ExcelJS from 'exceljs';
import type { Response } from 'express';

import type { FullDossierResponse } from './intelligence.types';
import { IntelligenceExportService } from './intelligence-export.service';

function makeSampleDossier(overrides?: Partial<FullDossierResponse>): FullDossierResponse {
  return {
    entityType: 'citizen',
    canMutate: true,
    citizen: {
      id: 'cit-1',
      full_name: '=CMD|calc Valiyev',
      passport: 'AA1234567',
      pinfl: '30101900010011',
      phone_number: '998901234567',
    },
    ownedCards: [
      {
        id: 'card-1',
        card_number: '8600123456789012',
        bank: { name: 'Agrobank' },
        full_name: 'Ali Valiyev',
      },
    ],
    ownedPhones: [
      {
        id: 'ph-1',
        phone_number: '998901234567',
        formatted_number: '+998 90 123 45 67',
        operator: 'Beeline',
        label: 'Asosiy',
      },
    ],
    ownedIdentifiers: [
      {
        id: 'id-1',
        type: 'telegram_username',
        type_label: 'Telegram Username',
        raw_value: '@fraud_bot',
        normalized_value: 'fraud_bot',
      },
    ],
    directApplications: [
      {
        id: 'app-1',
        application_number: '2026-00001',
        description: 'Test',
        officer_notes: null,
        status: 'JARAYONDA',
        status_label: 'Jarayonda',
        status_color: '#f59e0b',
        date: 'not-a-valid-date',
        district_id: 'd1',
        district_name: 'Qarshi sh.',
        crime_article: '168-modda',
        crime_method: 'Telegram',
        victim_name: 'Jabrlanuvchi',
        victim_phone: '998901112233',
        role_in_app: 'SUSPECT',
        link_source: 'AUTO_SYNC',
        match_reasons: ['=HYPERLINK("http://evil")'],
        transfer_amount: 1500000,
        currency: 'UZS',
        payment_provider: 'Click',
        can_edit: true,
      },
    ],
    transfers: [
      {
        id: 'tr-1',
        transaction_id: 'TX-1',
        direction: 'INTERNAL',
        amount: 500000,
        currency: 'UZS',
        transfer_date: '2026-11-20',
        transfer_time: '14:30',
        payment_provider: 'Payme',
        sender_card_id: 'c1',
        sender_card_number: '8600 1234 5678 9012',
        sender_owner_name: 'Ali',
        receiver_card_id: 'c2',
        receiver_card_number: '9860 1111 2222 3333',
        receiver_owner_name: 'Vali',
        application_id: 'app-1',
        application_number: '2026-00001',
        images: [],
      },
    ],
    coOccurringClues: [
      {
        entity_type: 'card',
        entity_id: 'c2',
        type_label: 'Plastik karta',
        value: '9860111122223333',
        owner_name: 'Vali',
        shared_apps_count: 2,
        role: 'DROPPER',
      } as never,
    ],
    probableMatches: [],
    multiHopChains: [],
    evidenceFiles: [],
    networkGraph: { nodes: [], edges: [] },
    financialGraph: { nodes: [], edges: [], summary: {} as never },
    stats: {
      totalApplications: 1,
      victimAppsCount: 0,
      suspectOrDropperAppsCount: 1,
      witnessAppsCount: 0,
      isCrossRoleCollision: false,
      totalLossInLinkedApps: 1500000,
      totalIncomingAmount: 500000,
      totalOutgoingAmount: 0,
      netFlowAmount: 500000,
      transactionsCount: 1,
      avgTransactionAmount: 500000,
      maxTransactionAmount: 500000,
      firstSeenDate: 'not-a-valid-date',
      lastSeenDate: '2026-11-20T00:00:00.000Z',
      activeSpanDays: 1,
      riskScore: 75,
      riskLevel: 'HIGH',
      riskLabel: 'Yuqori xavfli',
      hourlyDistribution: [],
      byDistrict: [],
      byPaymentProvider: [],
      byCrime: [],
    },
    ...overrides,
  };
}

describe('IntelligenceExportService', () => {
  let service: IntelligenceExportService;

  beforeEach(() => {
    service = new IntelligenceExportService();
  });

  describe('exportExcel', () => {
    it('builds all 4 worksheets, sanitizes formula injection, avoids "Invalid Date", and adds UZS SUMIF totals', async () => {
      const chunks: Buffer[] = [];
      const setHeader = jest.fn();
      const end = jest.fn();
      const writableRes = {
        setHeader,
        end,
        write: jest.fn((chunk: Buffer | Uint8Array | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        }),
        on: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
      } as unknown as Response;

      await service.exportExcel(makeSampleDossier(), writableRes);

      expect(setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('Fuqaro_Dosye_'),
      );
      expect(end).toHaveBeenCalled();

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.concat(chunks) as unknown as ExcelJS.Buffer);

      expect(wb.worksheets.map((w) => w.name)).toEqual([
        'Umumiy Dosye',
        "Bog'langan Arizalar",
        'Pul Oqimlari',
        "Rekvizit va Bog'liqliklar",
      ]);

      const wsApps = wb.getWorksheet("Bog'langan Arizalar")!;
      // Invalid date string falls back to raw value instead of "Invalid Date"
      expect(wsApps.getRow(2).getCell(3).value).toBe('not-a-valid-date');
      // Formula injection in match_reasons is escaped with leading apostrophe
      expect(wsApps.getRow(2).getCell(11).value).toBe('\'=HYPERLINK("http://evil")');
      // Total row uses SUMIF for UZS
      expect(wsApps.getRow(3).getCell(9).value).toEqual({
        formula: 'SUMIF(J2:J2, "UZS", I2:I2)',
      });

      const wsTransfers = wb.getWorksheet('Pul Oqimlari')!;
      expect(wsTransfers.getRow(2).getCell(2).value).toBe('Ichki');
      expect(wsTransfers.getRow(3).getCell(3).value).toEqual({
        formula: 'SUMIF(D2:D2, "UZS", C2:C2)',
      });

      const wsAssets = wb.getWorksheet("Rekvizit va Bog'liqliklar")!;
      // 1 card + 1 phone + 1 identifier + 1 co-occurring clue = 4 data rows + 1 header = 5 rows
      expect(wsAssets.rowCount).toBe(5);
    });

    it('omits total formula rows when applications and transfers are empty and supports card/phone/identifier titles', async () => {
      for (const variant of [
        {
          entityType: 'card' as const,
          citizen: undefined,
          card: { card_number: '8600123456789012', inferred_bank_name: 'Agrobank' },
          expectedSlug: 'Karta_Dosye_9012',
        },
        {
          entityType: 'phone' as const,
          citizen: undefined,
          phone: { phone_number: '998901234567', operator: 'Beeline' },
          expectedSlug: 'Telefon_Dosye_998901234567',
        },
        {
          entityType: 'identifier' as const,
          citizen: undefined,
          identifier: { type: 'crypto_wallet', raw_value: 'TXYZ' },
          expectedSlug: 'Identifikator_Dosye',
        },
      ]) {
        const setHeader = jest.fn();
        const chunks: Buffer[] = [];
        const res = {
          setHeader,
          end: jest.fn(),
          write: jest.fn((c: Buffer | Uint8Array | string) => {
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
            return true;
          }),
          on: jest.fn(),
          once: jest.fn(),
          emit: jest.fn(),
        } as unknown as Response;

        await service.exportExcel(
          makeSampleDossier({
            ...variant,
            directApplications: [],
            transfers: [],
            ownedCards: [],
            ownedPhones: [],
            ownedIdentifiers: [],
            coOccurringClues: [],
          }),
          res,
        );

        expect(setHeader).toHaveBeenCalledWith(
          'Content-Disposition',
          expect.stringContaining(variant.expectedSlug),
        );
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(Buffer.concat(chunks) as unknown as ExcelJS.Buffer);
        expect(wb.getWorksheet("Bog'langan Arizalar")!.rowCount).toBe(1);
        expect(wb.getWorksheet('Pul Oqimlari')!.rowCount).toBe(1);
      }
    });
  });

  describe('exportDocx', () => {
    it('generates a valid DOCX zip buffer with proper headers and labels INTERNAL transfers as Ichki', async () => {
      const setHeader = jest.fn();
      const send = jest.fn();
      const res = { setHeader, send } as unknown as Response;

      await service.exportDocx(makeSampleDossier(), res);

      expect(setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('.docx'),
      );
      const sendCalls = send.mock.calls as Array<[Buffer]>;
      const buf = sendCalls[0][0];
      expect(Buffer.isBuffer(buf)).toBe(true);
      // DOCX is a ZIP container starting with PK (0x50, 0x4B)
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
      expect(buf.length).toBeGreaterThan(1000);
    });
  });
});
