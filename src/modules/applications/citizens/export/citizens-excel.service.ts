import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import {
  applyExcelAutoFilter,
  sanitizeExcelRow,
  styleExcelDataRow,
  styleExcelHeaderRow,
  styleExcelTotalRow,
} from '../../../../common/utils/excel-style.util';
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
      { header: '№', key: 'idx', width: 6 }, // A
      { header: 'Fuqaro (F.I.SH)', key: 'full_name', width: 28 }, // B
      { header: 'Jinsi', key: 'gender', width: 10 }, // C
      { header: "Tug'ilgan Sana", key: 'birth_date', width: 14 }, // D
      { header: 'Pasport Seriya', key: 'passport', width: 15 }, // E
      { header: 'JShShIR (PINFL)', key: 'pinfl', width: 18 }, // F
      { header: 'Asosiy Telefon', key: 'phone', width: 18 }, // G
      { header: "Qo'shimcha Telefonlar", key: 'extra_phones', width: 24 }, // H
      { header: 'Tuman / Shahar', key: 'district', width: 18 }, // I
      { header: 'Mahalla', key: 'neighborhood', width: 22 }, // J
      { header: 'Yashash Manzili', key: 'address', width: 32 }, // K
      { header: 'Kasb Toifasi', key: 'occ_category', width: 24 }, // L
      { header: 'Kasb Turi', key: 'occupation', width: 24 }, // M
      { header: 'Ish Joyi / Tashkilot', key: 'workplace', width: 30 }, // N
      { header: 'Lavozimi', key: 'work_position', width: 22 }, // O
      { header: 'Plastik Kartalari (Banki bilan)', key: 'cards_list', width: 36 }, // P
      { header: 'Kartalar Soni', key: 'cards_count', width: 14 }, // Q
      { header: 'Aloqador Arizalar', key: 'apps_list', width: 28 }, // R
      { header: 'Arizalar Soni', key: 'apps_count', width: 14 }, // S
      { header: "Ro'yxatga Olingan Sana", key: 'created_at', width: 18 }, // T
    ];

    styleExcelHeaderRow(ws.getRow(1));
    applyExcelAutoFilter(ws, 1);

    citizens.forEach((citizen, index) => {
      const fullName =
        [citizen.last_name, citizen.first_name, citizen.middle_name].filter(Boolean).join(' ') ||
        '—';

      const genderStr =
        citizen.gender === 'female' ? 'Ayol' : citizen.gender === 'male' ? 'Erkak' : '—';
      const birthDateStr = citizen.birth_date
        ? new Date(citizen.birth_date).toISOString().slice(0, 10)
        : '—';

      const primaryPhone = citizen.phone_number?.trim() || '';
      const extraPhonesList = (Array.isArray(citizen.phones) ? citizen.phones : [])
        .map((p) => p.formatted_number || p.phone_number)
        .filter((num): num is string => Boolean(num && num.trim() && num.trim() !== primaryPhone));

      const cards = Array.isArray(citizen.cards) ? citizen.cards : [];
      const cardsListStr =
        cards
          .map((c) => {
            const num = c.card_number || c.masked_number;
            if (!num) return '';
            return c.bank?.name ? `${num} (${c.bank.name})` : num;
          })
          .filter(Boolean)
          .join(', ') || '—';

      const apps = Array.isArray(citizen.applications) ? citizen.applications : [];
      const appsListStr =
        apps
          .map((a) => a.application_number || `AR-${a.id.slice(0, 8)}`)
          .filter(Boolean)
          .join(', ') || '—';

      const createdDateStr = citizen.created_at
        ? new Date(citizen.created_at).toISOString().slice(0, 16).replace('T', ' ')
        : '—';

      const row = ws.addRow(
        sanitizeExcelRow({
          idx: index + 1,
          full_name: fullName,
          gender: genderStr,
          birth_date: birthDateStr,
          passport: citizen.passport || '—',
          pinfl: citizen.pinfl || '—',
          phone: primaryPhone || '—',
          extra_phones: extraPhonesList.join(', ') || '—',
          district: citizen.district?.name || '—',
          neighborhood: citizen.neighborhood?.name || '—',
          address: citizen.address || '—',
          occ_category: citizen.occupation_category?.name || '—',
          occupation: citizen.occupation?.name || '—',
          workplace: citizen.workplace?.name || '—',
          work_position: citizen.work_position || '—',
          cards_list: cardsListStr,
          cards_count: cards.length,
          apps_list: appsListStr,
          apps_count: apps.length,
          created_at: createdDateStr,
        }),
      );

      styleExcelDataRow(row, ['address', 'cards_list', 'apps_list']);

      row.getCell('passport').numFmt = '@';
      row.getCell('pinfl').numFmt = '@';
      row.getCell('phone').numFmt = '@';
      row.getCell('extra_phones').numFmt = '@';
      row.getCell('cards_list').numFmt = '@';
      row.getCell('apps_list').numFmt = '@';

      row.getCell('cards_count').numFmt = '#,##0';
      row.getCell('cards_count').alignment = { horizontal: 'center', vertical: 'middle' };

      row.getCell('apps_count').numFmt = '#,##0';
      row.getCell('apps_count').alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const summaryRow = ws.addRow({
        cards_list: 'JAMI:',
        cards_count: { formula: `SUM(Q2:Q${lastDataRow})` },
        apps_count: { formula: `SUM(S2:S${lastDataRow})` },
      });

      styleExcelTotalRow(summaryRow);
      summaryRow.getCell('cards_list').alignment = { horizontal: 'right', vertical: 'middle' };
      summaryRow.getCell('cards_count').numFmt = '#,##0';
      summaryRow.getCell('cards_count').alignment = { horizontal: 'center', vertical: 'middle' };
      summaryRow.getCell('apps_count').numFmt = '#,##0';
      summaryRow.getCell('apps_count').alignment = { horizontal: 'center', vertical: 'middle' };
    }

    return Promise.resolve(workbook);
  }
}
