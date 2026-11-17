import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

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
      { header: '№', key: 'idx', width: 6 },
      { header: 'Tranzaksiya ID', key: 'tx_id', width: 22 },
      { header: 'Ariza Raqami', key: 'app_num', width: 22 },
      { header: 'Jabrlanuvchi F.I.SH', key: 'sender_name', width: 28 },
      { header: 'Jabrlanuvchi Kartasi', key: 'sender_card', width: 22 },
      { header: "Xizmat Ko'rsatuvchi Bank", key: 'sender_bank', width: 24 },
      { header: "O'tkazma Summasi", key: 'amount', width: 22 },
      { header: 'Valyuta', key: 'currency', width: 10 },
      { header: "To'lov Provayderi / Ilova", key: 'provider', width: 24 },
      { header: "O'tkazma Sanasi", key: 'transfer_date', width: 18 },
      { header: 'Qabul Qiluvchi (Firibgar) Karta', key: 'receiver_card', width: 26 },
      { header: 'Firibgar Kartasi Banki', key: 'receiver_bank', width: 24 },
      { header: 'Firibgar F.I.SH / Nomi', key: 'receiver_name', width: 28 },
      { header: 'Holati', key: 'status', width: 16 },
    ];

    this.styleHeaderRow(ws.getRow(1));

    transfers.forEach((t, index) => {
      const senderCard = t.sender_card;
      const receiverCard = t.receiver_card;

      const senderCitizen = senderCard?.citizen;
      const senderName =
        senderCard?.full_name ||
        (senderCitizen
          ? [senderCitizen.last_name, senderCitizen.first_name, senderCitizen.middle_name]
              .filter(Boolean)
              .join(' ')
          : '—');

      const receiverCitizen = receiverCard?.citizen;
      const receiverName =
        receiverCard?.full_name ||
        (receiverCitizen
          ? [receiverCitizen.last_name, receiverCitizen.first_name, receiverCitizen.middle_name]
              .filter(Boolean)
              .join(' ')
          : '—');

      const transferDateStr = t.transfer_date
        ? `${t.transfer_date}${t.transfer_time ? ` ${t.transfer_time}` : ''}`
        : t.created_at
          ? new Date(t.created_at).toISOString().slice(0, 16).replace('T', ' ')
          : '—';

      const appNum = t.application?.application_number || '—';

      const row = ws.addRow({
        idx: index + 1,
        tx_id: t.transaction_id || '—',
        app_num: appNum,
        sender_name: senderName,
        sender_card: senderCard?.card_number || senderCard?.masked_number || '—',
        sender_bank: senderCard?.bank?.name || '—',
        amount: Number(t.amount) || 0,
        currency: t.currency || 'UZS',
        provider: t.payment_provider?.name || '—',
        transfer_date: transferDateStr,
        receiver_card: receiverCard?.card_number || receiverCard?.masked_number || '—',
        receiver_bank: receiverCard?.bank?.name || '—',
        receiver_name: receiverName,
        status: t.status || 'Tugallangan',
      });

      this.styleDataRow(row);

      // Matn formatlari (@)
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
      // 1. Jami Summa (Double bottom border bilan)
      const totalRow = ws.addRow({
        idx: '',
        tx_id: '',
        app_num: '',
        sender_name: '',
        sender_card: '',
        sender_bank: 'JAMI ZARAR:',
        amount: { formula: `SUM(G2:G${lastDataRow})` },
        currency: 'UZS',
        provider: '',
        transfer_date: '',
        receiver_card: '',
        receiver_bank: '',
        receiver_name: '',
        status: '',
      });

      this.styleTotalRow(totalRow);
      totalRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      // 2. O'rtacha Summa
      const avgRow = ws.addRow({
        idx: '',
        tx_id: '',
        app_num: '',
        sender_name: '',
        sender_card: '',
        sender_bank: "O'RTACHA ZARAR:",
        amount: { formula: `AVERAGE(G2:G${lastDataRow})` },
        currency: 'UZS',
        provider: '',
        transfer_date: '',
        receiver_card: '',
        receiver_bank: '',
        receiver_name: '',
        status: '',
      });
      this.styleSubTotalRow(avgRow);
      avgRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      avgRow.getCell('amount').numFmt = '#,##0.00';
      avgRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      // 3. Jami O'tkazmalar Soni
      const countRow = ws.addRow({
        idx: '',
        tx_id: '',
        app_num: '',
        sender_name: '',
        sender_card: '',
        sender_bank: "O'TKAZMALAR SONI:",
        amount: { formula: `COUNT(G2:G${lastDataRow})` },
        currency: 'ta',
        provider: '',
        transfer_date: '',
        receiver_card: '',
        receiver_bank: '',
        receiver_name: '',
        status: '',
      });
      this.styleSubTotalRow(countRow);
      countRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      countRow.getCell('amount').numFmt = '#,##0';
      countRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
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

  private styleSubTotalRow(row: ExcelJS.Row): void {
    row.height = 23;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: '000000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } },
      };
    });
  }
}
