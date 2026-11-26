import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import {
  applyExcelAutoFilter,
  formatDestinationType,
  formatTransferDateTime,
  formatTransferStatus,
  sanitizeExcelRow,
  styleExcelDataRow,
  styleExcelHeaderRow,
  styleExcelSubTotalRow,
  styleExcelTotalRow,
} from '../../../../common/utils/excel-style.util';
import { Transfer } from '../transfer.entity';

@Injectable()
export class TransfersExcelService {
  generateWorkbook(transfers: Transfer[]): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();
    workbook.modified = new Date();

    const ws = workbook.addWorksheet("To'lov o'tkazmalari", {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 }, // A
      { header: 'Tranzaksiya ID', key: 'tx_id', width: 20 }, // B
      { header: 'Ariza Raqami', key: 'app_num', width: 20 }, // C
      { header: 'Hudud (Tuman)', key: 'district', width: 18 }, // D
      { header: "Jo'natuvchi F.I.SH", key: 'sender_name', width: 28 }, // E
      { header: "Jo'natuvchi Kartasi", key: 'sender_card', width: 22 }, // F
      { header: "Jo'natuvchi Banki", key: 'sender_bank', width: 22 }, // G
      { header: "O'tkazma Summasi", key: 'amount', width: 20 }, // H
      { header: 'Valyuta', key: 'currency', width: 10 }, // I
      { header: "To'lov Provayderi / Ilova", key: 'provider', width: 22 }, // J
      { header: "O'tkazma Sanasi va Vaqti", key: 'transfer_date', width: 18 }, // K
      { header: 'Chiqish Kanali', key: 'dest_type', width: 20 }, // L
      { header: 'Qabul Qiluvchi Karta / Rekvizit', key: 'receiver_card', width: 28 }, // M
      { header: 'Qabul Qiluvchi Banki', key: 'receiver_bank', width: 22 }, // N
      { header: 'Qabul Qiluvchi F.I.SH / Nomi', key: 'receiver_name', width: 28 }, // O
      { header: 'Holati', key: 'status', width: 16 }, // P
    ];

    styleExcelHeaderRow(ws.getRow(1));
    applyExcelAutoFilter(ws, 1);

    transfers.forEach((t, index) => {
      const senderCard = t.sender_card;
      const receiverCard = t.receiver_card;

      const senderCitizen = senderCard?.citizen || t.application?.citizen;
      const senderName = senderCard?.full_name || senderCitizen?.full_name?.trim() || '—';

      const receiverCitizen = receiverCard?.citizen;
      const receiverName =
        receiverCard?.full_name || receiverCitizen?.full_name?.trim() || t.destination_label || '—';

      const receiverAccount =
        receiverCard?.card_number ||
        receiverCard?.masked_number ||
        t.receiver_identifier?.raw_value ||
        t.destination_label ||
        '—';

      const appNum =
        t.application?.application_number ||
        (t.application_id ? `AR-${t.application_id.slice(0, 8)}` : '—');

      const row = ws.addRow(
        sanitizeExcelRow({
          idx: index + 1,
          tx_id: t.transaction_id || '—',
          app_num: appNum,
          district: t.application?.district?.name || '—',
          sender_name: senderName,
          sender_card: senderCard?.card_number || senderCard?.masked_number || '—',
          sender_bank: senderCard?.bank?.name || '—',
          amount: Number(t.amount) || 0,
          currency: t.currency || 'UZS',
          provider: t.payment_provider?.name || '—',
          transfer_date: formatTransferDateTime(t.transfer_date, t.transfer_time, t.created_at),
          dest_type: formatDestinationType(t.destination_type),
          receiver_card: receiverAccount,
          receiver_bank: receiverCard?.bank?.name || '—',
          receiver_name: receiverName,
          status: formatTransferStatus(t.status),
        }),
      );

      styleExcelDataRow(row);

      row.getCell('tx_id').numFmt = '@';
      row.getCell('app_num').numFmt = '@';
      row.getCell('sender_card').numFmt = '@';
      row.getCell('receiver_card').numFmt = '@';

      const amountCell = row.getCell('amount');
      amountCell.numFmt = '#,##0.00';
      amountCell.alignment = { horizontal: 'right', vertical: 'middle' };
    });

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const totalRow = ws.addRow({
        sender_bank: 'JAMI ZARAR (UZS):',
        amount: { formula: `SUMIF(I2:I${lastDataRow}, "UZS", H2:H${lastDataRow})` },
        currency: 'UZS',
      });

      styleExcelTotalRow(totalRow);
      totalRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      const avgRow = ws.addRow({
        sender_bank: "O'RTACHA ZARAR (UZS):",
        amount: { formula: `IFERROR(AVERAGEIF(I2:I${lastDataRow}, "UZS", H2:H${lastDataRow}), 0)` },
        currency: 'UZS',
      });
      styleExcelSubTotalRow(avgRow);
      avgRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      avgRow.getCell('amount').numFmt = '#,##0.00';
      avgRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      const countRow = ws.addRow({
        sender_bank: "O'TKAZMALAR SONI:",
        amount: { formula: `COUNT(H2:H${lastDataRow})` },
        currency: 'ta',
      });
      styleExcelSubTotalRow(countRow);
      countRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      countRow.getCell('amount').numFmt = '#,##0';
      countRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
    }

    return Promise.resolve(workbook);
  }
}
