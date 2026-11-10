import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { Card } from '../card.entity';

@Injectable()
export class CardsExcelService {
  generateWorkbook(cards: Card[]): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'IIV Xavfsiz Shaxar / Qashqadaryo viloyati IIB';
    workbook.created = new Date();
    workbook.modified = new Date();

    const ws = workbook.addWorksheet('Plastik kartalar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Karta Raqami', key: 'card_number', width: 22 },
      { header: 'Bank Nomi', key: 'bank_name', width: 24 },
      { header: 'Karta Egasi (F.I.SH)', key: 'owner_name', width: 28 },
      { header: 'Egasi Telefoni', key: 'owner_phone', width: 18 },
      { header: 'Egasi Pasporti / JShShIR', key: 'owner_doc', width: 24 },
      { header: 'Amal Qilish Muddati', key: 'expire_date', width: 16 },
      { header: 'Aloqador Arizalar', key: 'apps_count', width: 18 },
      { header: 'Kiritilgan Sana', key: 'created_at', width: 20 },
    ];

    this.styleHeaderRow(ws.getRow(1));

    cards.forEach((card, index) => {
      const citizen = card.citizen;
      const ownerName =
        card.full_name ||
        (citizen
          ? [citizen.last_name, citizen.first_name, citizen.middle_name].filter(Boolean).join(' ')
          : '—');

      const ownerPhone = citizen?.phone_number || '—';
      const ownerDoc = citizen?.passport
        ? `${citizen.passport}${citizen.pinfl ? ` / ${citizen.pinfl}` : ''}`
        : citizen?.pinfl || '—';

      const appsCount = Array.isArray(card.applications) ? card.applications.length : 0;

      const createdDateStr = card.created_at
        ? new Date(card.created_at).toISOString().slice(0, 16).replace('T', ' ')
        : '—';

      const row = ws.addRow({
        idx: index + 1,
        card_number: card.card_number || card.masked_number || '—',
        bank_name: card.bank?.name || '—',
        owner_name: ownerName,
        owner_phone: ownerPhone,
        owner_doc: ownerDoc,
        expire_date: card.expire_date || '—',
        apps_count: appsCount,
        created_at: createdDateStr,
      });

      this.styleDataRow(row);

      // Karta, telefon, hujjatlar - matn (@)
      row.getCell('card_number').numFmt = '@';
      row.getCell('owner_phone').numFmt = '@';
      row.getCell('owner_doc').numFmt = '@';
      row.getCell('expire_date').numFmt = '@';

      row.getCell('apps_count').numFmt = '#,##0';
      row.getCell('apps_count').alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const summaryRow = ws.addRow({
        idx: '',
        card_number: '',
        bank_name: '',
        owner_name: '',
        owner_phone: '',
        owner_doc: '',
        expire_date: 'JAMI:',
        apps_count: { formula: `SUM(H2:H${lastDataRow})` },
        created_at: '',
      });

      this.styleTotalRow(summaryRow);
      summaryRow.getCell('expire_date').alignment = { horizontal: 'right', vertical: 'middle' };
      summaryRow.getCell('apps_count').numFmt = '#,##0';
      summaryRow.getCell('apps_count').alignment = { horizontal: 'center', vertical: 'middle' };
    }

    return Promise.resolve(workbook);
  }

  private styleHeaderRow(row: ExcelJS.Row): void {
    row.height = 28;
    row.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: '94A3B8' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        bottom: { style: 'medium', color: { argb: '000000' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } },
      };
    });
  }

  private styleDataRow(row: ExcelJS.Row): void {
    row.height = 22;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 9.5, color: { argb: '000000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } },
      };
    });
  }

  private styleTotalRow(row: ExcelJS.Row): void {
    row.height = 25;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
      cell.border = {
        top: { style: 'thin', color: { argb: '000000' } },
        bottom: { style: 'double', color: { argb: '000000' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } },
      };
    });
  }
}
