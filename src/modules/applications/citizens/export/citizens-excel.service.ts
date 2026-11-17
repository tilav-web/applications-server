import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { Citizen } from '../citizen.entity';

@Injectable()
export class CitizensExcelService {
  generateWorkbook(citizens: Citizen[]): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();
    workbook.modified = new Date();

    const ws = workbook.addWorksheet("Fuqarolar ro'yxati", {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Fuqaro (F.I.SH)', key: 'full_name', width: 30 },
      { header: 'Jinsi', key: 'gender', width: 10 },
      { header: "Tug'ilgan Sana", key: 'birth_date', width: 15 },
      { header: 'Pasport Seriya', key: 'passport', width: 16 },
      { header: 'JShShIR (PINFL)', key: 'pinfl', width: 18 },
      { header: 'Telefon Raqam', key: 'phone', width: 18 },
      { header: 'Tuman / Shahar', key: 'district', width: 18 },
      { header: 'Mahalla', key: 'mahalla', width: 22 },
      { header: 'Yashash Manzili', key: 'address', width: 35 },
      { header: 'Plastik Kartalari', key: 'cards_list', width: 32 },
      { header: 'Kartalar Soni', key: 'cards_count', width: 15 },
      { header: 'Aloqador Arizalar', key: 'apps_count', width: 18 },
      { header: "Ro'yxatga Olingan Sana", key: 'created_at', width: 20 },
    ];

    this.styleHeaderRow(ws.getRow(1));

    citizens.forEach((citizen, index) => {
      const fullName =
        [citizen.last_name, citizen.first_name, citizen.middle_name].filter(Boolean).join(' ') ||
        '—';

      const genderStr =
        citizen.gender === 'female' ? 'Ayol' : citizen.gender === 'male' ? 'Erkak' : '—';
      const birthDateStr = citizen.birth_date
        ? new Date(citizen.birth_date).toISOString().slice(0, 10)
        : '—';

      const cards = Array.isArray(citizen.cards) ? citizen.cards : [];
      const cardsListStr =
        cards
          .map((c) => c.card_number || c.masked_number)
          .filter(Boolean)
          .join(', ') || '—';

      const appsCount = Array.isArray(citizen.applications) ? citizen.applications.length : 0;

      const createdDateStr = citizen.created_at
        ? new Date(citizen.created_at).toISOString().slice(0, 16).replace('T', ' ')
        : '—';

      const row = ws.addRow({
        idx: index + 1,
        full_name: fullName,
        gender: genderStr,
        birth_date: birthDateStr,
        passport: citizen.passport || '—',
        pinfl: citizen.pinfl || '—',
        phone: citizen.phone_number || '—',
        district: citizen.district?.name || '—',
        mahalla: citizen.mahalla?.name || '—',
        address: citizen.address || '—',
        cards_list: cardsListStr,
        cards_count: cards.length,
        apps_count: appsCount,
        created_at: createdDateStr,
      });

      this.styleDataRow(row);

      // Karta, pasport, pinfl, telefon - matn formati (@)
      row.getCell('passport').numFmt = '@';
      row.getCell('pinfl').numFmt = '@';
      row.getCell('phone').numFmt = '@';
      row.getCell('cards_list').numFmt = '@';

      row.getCell('cards_count').numFmt = '#,##0';
      row.getCell('cards_count').alignment = { horizontal: 'center', vertical: 'middle' };

      row.getCell('apps_count').numFmt = '#,##0';
      row.getCell('apps_count').alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const summaryRow = ws.addRow({
        idx: '',
        full_name: '',
        gender: '',
        birth_date: '',
        passport: '',
        pinfl: '',
        phone: '',
        district: '',
        mahalla: '',
        address: 'JAMI:',
        cards_list: '',
        cards_count: { formula: `SUM(L2:L${lastDataRow})` },
        apps_count: { formula: `SUM(M2:M${lastDataRow})` },
        created_at: '',
      });

      this.styleTotalRow(summaryRow);
      summaryRow.getCell('address').alignment = { horizontal: 'right', vertical: 'middle' };
      summaryRow.getCell('cards_count').numFmt = '#,##0';
      summaryRow.getCell('cards_count').alignment = { horizontal: 'center', vertical: 'middle' };
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
