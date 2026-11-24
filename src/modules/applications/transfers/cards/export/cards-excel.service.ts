import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import {
  applyExcelAutoFilter,
  styleExcelDataRow,
  styleExcelHeaderRow,
  styleExcelTotalRow,
} from '../../../../../common/utils/excel-style.util';
import { Card } from '../card.entity';

export interface CardExportStats {
  incomingCount: number;
  incomingAmount: number;
  outgoingCount: number;
  outgoingAmount: number;
  appNumbers: Set<string>;
}

@Injectable()
export class CardsExcelService {
  generateWorkbook(
    cards: Card[],
    statsMap?: Map<string, CardExportStats>,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();
    workbook.modified = new Date();

    const ws = workbook.addWorksheet('Plastik kartalar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 }, // A
      { header: 'Karta Raqami', key: 'card_number', width: 22 }, // B
      { header: 'Bank Nomi', key: 'bank_name', width: 24 }, // C
      { header: 'Karta Roli', key: 'role', width: 24 }, // D
      { header: 'Karta Egasi (F.I.SH)', key: 'owner_name', width: 28 }, // E
      { header: 'Egasi Telefoni', key: 'owner_phone', width: 18 }, // F
      { header: 'Egasi Pasporti / JShShIR', key: 'owner_doc', width: 24 }, // G
      { header: 'Amal Qilish Muddati', key: 'expire_date', width: 14 }, // H
      { header: 'Kirim Soni', key: 'in_count', width: 13 }, // I
      { header: 'Kirim Summasi (UZS)', key: 'in_amount', width: 22 }, // J
      { header: 'Chiqim Soni', key: 'out_count', width: 13 }, // K
      { header: 'Chiqim Summasi (UZS)', key: 'out_amount', width: 22 }, // L
      { header: 'Aloqador Arizalar', key: 'apps_list', width: 28 }, // M
      { header: 'Arizalar Soni', key: 'apps_count', width: 14 }, // N
      { header: 'Kiritilgan Sana', key: 'created_at', width: 18 }, // O
    ];

    styleExcelHeaderRow(ws.getRow(1));
    applyExcelAutoFilter(ws, 1);

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

      const st = statsMap?.get(card.id);
      const inCount = st?.incomingCount ?? 0;
      const inAmount = st?.incomingAmount ?? 0;
      const outCount = st?.outgoingCount ?? 0;
      const outAmount = st?.outgoingAmount ?? 0;

      const appNums = st
        ? Array.from(st.appNumbers)
        : (Array.isArray(card.applications) ? card.applications : []).map(
            (a) => a.application_number || `AR-${a.id.slice(0, 8)}`,
          );

      let roleStr = '—';
      if (inCount > 0 && outCount > 0) {
        roleStr = 'Tranzit / Aralash';
      } else if (inCount > 0) {
        roleStr = 'Qabul qiluvchi (Firibgar)';
      } else if (outCount > 0 || appNums.length > 0) {
        roleStr = "Jo'natuvchi (Jabrlanuvchi)";
      }

      const createdDateStr = card.created_at
        ? new Date(card.created_at).toISOString().slice(0, 16).replace('T', ' ')
        : '—';

      const row = ws.addRow({
        idx: index + 1,
        card_number: card.card_number || card.masked_number || '—',
        bank_name: card.bank?.name || '—',
        role: roleStr,
        owner_name: ownerName,
        owner_phone: ownerPhone,
        owner_doc: ownerDoc,
        expire_date: card.expire_date || '—',
        in_count: inCount,
        in_amount: inAmount,
        out_count: outCount,
        out_amount: outAmount,
        apps_list: appNums.join(', ') || '—',
        apps_count: appNums.length,
        created_at: createdDateStr,
      });

      styleExcelDataRow(row, ['apps_list']);

      row.getCell('card_number').numFmt = '@';
      row.getCell('owner_phone').numFmt = '@';
      row.getCell('owner_doc').numFmt = '@';
      row.getCell('expire_date').numFmt = '@';
      row.getCell('apps_list').numFmt = '@';

      for (const k of ['in_count', 'out_count', 'apps_count'] as const) {
        const c = row.getCell(k);
        c.numFmt = '#,##0';
        c.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      for (const k of ['in_amount', 'out_amount'] as const) {
        const c = row.getCell(k);
        c.numFmt = '#,##0.00';
        c.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const summaryRow = ws.addRow({
        expire_date: 'JAMI:',
        in_count: { formula: `SUM(I2:I${lastDataRow})` },
        in_amount: { formula: `SUM(J2:J${lastDataRow})` },
        out_count: { formula: `SUM(K2:K${lastDataRow})` },
        out_amount: { formula: `SUM(L2:L${lastDataRow})` },
        apps_count: { formula: `SUM(N2:N${lastDataRow})` },
      });

      styleExcelTotalRow(summaryRow);
      summaryRow.getCell('expire_date').alignment = { horizontal: 'right', vertical: 'middle' };
      for (const k of ['in_count', 'out_count', 'apps_count'] as const) {
        summaryRow.getCell(k).numFmt = '#,##0';
        summaryRow.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' };
      }
      for (const k of ['in_amount', 'out_amount'] as const) {
        summaryRow.getCell(k).numFmt = '#,##0.00';
        summaryRow.getCell(k).alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }

    return Promise.resolve(workbook);
  }
}
