import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { Application } from '../application.entity';

@Injectable()
export class ApplicationsExcelService {
  async generateWorkbook(applications: Application[]): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'IIV Xavfsiz Shaxar / Qashqadaryo viloyati IIB';
    workbook.created = new Date();
    workbook.modified = new Date();

    // 1. Sheet 1: Arizalar ro'yxati (Asosiy)
    this.buildApplicationsSheet(workbook, applications);

    // 2. Sheet 2: Pul o'tkazmalari & Moliyaviy zarar
    this.buildTransfersSheet(workbook, applications);

    // 3. Sheet 3: Gumonlanuvchilar belgilari
    this.buildSuspectsSheet(workbook, applications);

    // 4. Sheet 4: Xulosa va Statistika (Formulalar bilan)
    this.buildSummarySheet(workbook, applications.length);

    return workbook;
  }

  /**
   * 1-SHEET: Arizalar ro'yxati
   */
  private buildApplicationsSheet(workbook: ExcelJS.Workbook, applications: Application[]): void {
    const ws = workbook.addWorksheet("Arizalar ro'yxati", {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { tabColor: { argb: '1E3A8A' } },
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'app_num', width: 22 },
      { header: 'Ariza Sanasi', key: 'date', width: 14 },
      { header: 'Holati', key: 'status', width: 16 },
      { header: 'Hudud (Tuman)', key: 'district', width: 18 },
      { header: 'Mahalla', key: 'mahalla', width: 20 },
      { header: 'Jinoyat Moddasi', key: 'crime', width: 24 },
      { header: 'Jinoyat Usuli', key: 'crime_method', width: 32 },
      { header: 'Arizachi (F.I.SH)', key: 'citizen_name', width: 28 },
      { header: 'Jinsi', key: 'gender', width: 10 },
      { header: 'Telefon Raqam', key: 'phone', width: 18 },
      { header: 'Pasport Seriya', key: 'passport', width: 16 },
      { header: 'JShShIR (PINFL)', key: 'pinfl', width: 18 },
      { header: 'Yashash Manzili', key: 'address', width: 35 },
      { header: "O'tkazmalar Soni", key: 'transfers_count', width: 16 },
      { header: "Zarar Miqdori (so'm)", key: 'total_amount', width: 22 },
      { header: 'Tafsilot (Fabula)', key: 'description', width: 45 },
      { header: 'Xodim Qaydlari', key: 'notes', width: 35 },
    ];

    this.styleHeaderRow(ws.getRow(1), '1E3A8A');

    applications.forEach((app, index) => {
      const citizen = app.citizen;
      const citizenName = citizen
        ? [citizen.last_name, citizen.first_name, citizen.middle_name].filter(Boolean).join(' ')
        : '—';

      const transfers = this.extractAllTransfers(app);
      const totalAmount = transfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      const dateStr = app.date
        ? new Date(app.date).toISOString().slice(0, 10)
        : app.created_at
          ? new Date(app.created_at).toISOString().slice(0, 10)
          : '—';

      const statusName = app.application_status?.name || app.status || 'Yangi';

      const row = ws.addRow({
        idx: index + 1,
        app_num: app.application_number || '—',
        date: dateStr,
        status: statusName,
        district: app.district?.name || citizen?.district?.name || '—',
        mahalla: citizen?.mahalla?.name || '—',
        crime: app.crime ? app.crime.article || app.crime.title : '—',
        crime_method: app.crime_method?.name || '—',
        citizen_name: citizenName,
        gender: citizen?.gender === 'female' ? 'Ayol' : citizen?.gender === 'male' ? 'Erkak' : '—',
        phone: citizen?.phone_number || '—',
        passport: citizen?.passport || '—',
        pinfl: citizen?.pinfl || '—',
        address: citizen?.address || '—',
        transfers_count: transfers.length,
        total_amount: totalAmount,
        description: app.description || '—',
        notes: app.officer_notes || '—',
      });

      this.styleDataRow(row, index);

      // Total amount formatting
      const amountCell = row.getCell('total_amount');
      amountCell.numFmt = '#,##0 "so\'m"';
      amountCell.alignment = { horizontal: 'right', vertical: 'middle' };

      const countCell = row.getCell('transfers_count');
      countCell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  /**
   * 2-SHEET: Pul o'tkazmalari & Kartalar
   */
  private buildTransfersSheet(workbook: ExcelJS.Workbook, applications: Application[]): void {
    const ws = workbook.addWorksheet("Pul o'tkazmalari", {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { tabColor: { argb: '059669' } },
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'app_num', width: 22 },
      { header: 'Arizachi F.I.SH', key: 'citizen_name', width: 28 },
      { header: 'Jabrlanuvchi Kartasi', key: 'sender_card', width: 22 },
      { header: "Xizmat Ko'rsatuvchi Bank", key: 'sender_bank', width: 24 },
      { header: "O'tkazma Summasi", key: 'amount', width: 20 },
      { header: 'Valyuta', key: 'currency', width: 10 },
      { header: "To'lov Provayderi / Ilova", key: 'provider', width: 24 },
      { header: "O'tkazma Sanasi", key: 'transfer_date', width: 18 },
      { header: 'Qabul Qiluvchi (Firibgar) Karta', key: 'receiver_card', width: 26 },
      { header: 'Firibgar Kartasi Banki', key: 'receiver_bank', width: 24 },
      { header: 'Firibgar F.I.SH / Nomi', key: 'receiver_name', width: 28 },
      { header: 'Holati / Izoh', key: 'status', width: 18 },
    ];

    this.styleHeaderRow(ws.getRow(1), '059669');

    let transferIndex = 0;
    for (const app of applications) {
      const citizenName = app.citizen
        ? [app.citizen.last_name, app.citizen.first_name, app.citizen.middle_name]
            .filter(Boolean)
            .join(' ')
        : '—';

      const transfers = this.extractAllTransfers(app);

      for (const t of transfers) {
        transferIndex++;
        const senderCard = t.sender_card?.card_number || '—';
        const senderBank = t.sender_card?.bank?.name || t.sender_bank_name || '—';
        const receiverCard = t.receiver_card?.card_number || '—';
        const receiverBank = t.receiver_card?.bank?.name || t.receiver_bank_name || '—';
        const receiverName = t.receiver_card?.citizen
          ? [
              t.receiver_card.citizen.last_name,
              t.receiver_card.citizen.first_name,
              t.receiver_card.citizen.middle_name,
            ]
              .filter(Boolean)
              .join(' ')
          : t.receiver_name || '—';

        const row = ws.addRow({
          idx: transferIndex,
          app_num: app.application_number || '—',
          citizen_name: citizenName,
          sender_card: senderCard,
          sender_bank: senderBank,
          amount: Number(t.amount) || 0,
          currency: t.currency || 'UZS',
          provider: t.payment_provider?.name || t.provider_name || '—',
          transfer_date: t.transfer_date
            ? new Date(t.transfer_date).toISOString().slice(0, 16).replace('T', ' ')
            : '—',
          receiver_card: receiverCard,
          receiver_bank: receiverBank,
          receiver_name: receiverName,
          status: t.status || 'Tugallangan',
        });

        this.styleDataRow(row, transferIndex);

        const amountCell = row.getCell('amount');
        amountCell.numFmt = '#,##0.00';
        amountCell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }

    // Formulas: TOTAL and AVERAGE rows at the bottom
    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      // Jami Summa Qatori
      const totalRow = ws.addRow({
        idx: '',
        app_num: '',
        citizen_name: '',
        sender_card: '',
        sender_bank: 'JAMI ZARAR:',
        amount: { formula: `SUM(F2:F${lastDataRow})` },
        currency: 'UZS',
        provider: '',
        transfer_date: '',
        receiver_card: '',
        receiver_bank: '',
        receiver_name: '',
        status: '',
      });

      totalRow.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: '065F46' } };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D1FAE5' } };
      totalRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      // O'rtacha Summa Qatori
      const avgRow = ws.addRow({
        idx: '',
        app_num: '',
        citizen_name: '',
        sender_card: '',
        sender_bank: "O'RTACHA ZARAR:",
        amount: { formula: `AVERAGE(F2:F${lastDataRow})` },
        currency: 'UZS',
        provider: '',
        transfer_date: '',
        receiver_card: '',
        receiver_bank: '',
        receiver_name: '',
        status: '',
      });

      avgRow.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: '1E3A8A' } };
      avgRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
      avgRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      avgRow.getCell('amount').numFmt = '#,##0.00';
      avgRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      // Jami O'tkazmalar Soni
      const countRow = ws.addRow({
        idx: '',
        app_num: '',
        citizen_name: '',
        sender_card: '',
        sender_bank: "O'TKAZMALAR SONI:",
        amount: { formula: `COUNT(F2:F${lastDataRow})` },
        currency: 'ta',
        provider: '',
        transfer_date: '',
        receiver_card: '',
        receiver_bank: '',
        receiver_name: '',
        status: '',
      });
      countRow.font = { name: 'Segoe UI', size: 10, bold: true };
      countRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
      countRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      countRow.getCell('amount').numFmt = '#,##0';
      countRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
    }
  }

  /**
   * 3-SHEET: Gumonlanuvchilar belgilari (Suspect Attributes)
   */
  private buildSuspectsSheet(workbook: ExcelJS.Workbook, applications: Application[]): void {
    const ws = workbook.addWorksheet('Gumonlanuvchilar', {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { tabColor: { argb: 'DC2626' } },
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'app_num', width: 22 },
      { header: 'Jinoyat Moddasi', key: 'crime', width: 24 },
      { header: 'Belgi / Maydon Nomi', key: 'field_name', width: 24 },
      { header: 'Identifikator Qiymati', key: 'field_value', width: 32 },
      { header: 'Izoh / Tavsif', key: 'note', width: 35 },
      { header: 'Qayd Sanasi', key: 'created_at', width: 16 },
    ];

    this.styleHeaderRow(ws.getRow(1), 'DC2626');

    let suspectIndex = 0;
    for (const app of applications) {
      const suspectItems = this.extractSuspectItems(app.suspect_tree);
      const dateStr = app.created_at ? new Date(app.created_at).toISOString().slice(0, 10) : '—';
      const crimeStr = app.crime ? app.crime.article || app.crime.title : '—';

      for (const item of suspectItems) {
        suspectIndex++;
        const row = ws.addRow({
          idx: suspectIndex,
          app_num: app.application_number || '—',
          crime: crimeStr,
          field_name: item.label,
          field_value: item.value,
          note: item.note || '—',
          created_at: dateStr,
        });

        this.styleDataRow(row, suspectIndex);

        row.getCell('field_value').font = {
          name: 'Consolas',
          size: 10,
          bold: true,
          color: { argb: '1E3A8A' },
        };
      }
    }
  }

  /**
   * 4-SHEET: Xulosa va Statistika (Excel Formulalari bilan)
   */
  private buildSummarySheet(workbook: ExcelJS.Workbook, appCount: number): void {
    const ws = workbook.addWorksheet('Xulosa va Statistika', {
      properties: { tabColor: { argb: '7C3AED' } },
    });

    ws.columns = [{ width: 5 }, { width: 38 }, { width: 22 }, { width: 14 }, { width: 30 }];

    // Sarlavha
    ws.mergeCells('B2:E2');
    const titleCell = ws.getCell('B2');
    titleCell.value = '«ARIZALAR VA MUROJAATLAR» TIZIMI TAHLILIY HISOBOTI';
    titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 36;

    // Generatsiya sanasi
    ws.mergeCells('B3:E3');
    const subTitle = ws.getCell('B3');
    subTitle.value = `Hisobot shakllantirilgan sana: ${new Date().toLocaleString('uz-UZ')}`;
    subTitle.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: '64748B' } };
    subTitle.alignment = { horizontal: 'center', vertical: 'middle' };

    // Bo'lim 1: Moliyaviy va Umumiy Ko'rsatkichlar
    const sec1 = ws.getCell('B5');
    sec1.value = "1. ASOSIY UMUMIY VA MOLIYAVIY KO'RSATKICHLAR";
    sec1.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: '1E3A8A' } };

    const maxAppRow = Math.max(appCount + 1, 2);

    const kpiRows = [
      {
        title: 'Jami arizalar soni',
        formula: `COUNTA('Arizalar ro''yxati'!B2:B${maxAppRow})`,
        unit: 'ta ariza',
        format: '#,##0',
      },
      {
        title: "Jami noqonuniy pul o'tkazmalari",
        formula: `COUNT('Pul o''tkazmalari'!F2:F10000)`,
        unit: 'ta tranzaksiya',
        format: '#,##0',
      },
      {
        title: 'Jami yetkazilgan moddiy zarar miqdori',
        formula: `SUM('Pul o''tkazmalari'!F2:F10000)`,
        unit: "so'm (UZS)",
        format: '#,##0.00',
      },
      {
        title: "O'rtacha bitta o'tkazma zarari",
        formula: `AVERAGE('Pul o''tkazmalari'!F2:F10000)`,
        unit: "so'm (UZS)",
        format: '#,##0.00',
      },
      {
        title: 'Aniqlangan gumonlanuvchilar belgilari',
        formula: `COUNTA('Gumonlanuvchilar'!B2:B10000)`,
        unit: 'ta rekvizit',
        format: '#,##0',
      },
    ];

    let curRow = 6;
    kpiRows.forEach((kpi) => {
      const r = ws.getRow(curRow);
      r.getCell(2).value = kpi.title;
      r.getCell(2).font = { name: 'Segoe UI', size: 10, bold: true };

      const valCell = r.getCell(3);
      valCell.value = { formula: kpi.formula };
      valCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: '059669' } };
      valCell.numFmt = kpi.format;
      valCell.alignment = { horizontal: 'right' };

      r.getCell(4).value = kpi.unit;
      r.getCell(4).font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: '64748B' } };

      r.height = 24;
      this.applyBorder(r, 2, 4);
      curRow++;
    });

    // Bo'lim 2: Arizalarning holatlar bo'yicha taqsimoti
    curRow += 2;
    const sec2 = ws.getCell(`B${curRow}`);
    sec2.value = "2. ARIZALARNING HOLATLAR BO'YICHA TAQSIMOTI";
    sec2.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: '1E3A8A' } };
    curRow++;

    const statusRows = [
      {
        label: 'Yangi (Qabul qilingan) arizalar',
        formula: `COUNTIF('Arizalar ro''yxati'!D2:D${maxAppRow}, "*Yangi*")`,
      },
      {
        label: 'Jarayonda (Tergovda) arizalar',
        formula: `COUNTIF('Arizalar ro''yxati'!D2:D${maxAppRow}, "*Jarayon*")`,
      },
      {
        label: 'Hal qilingan (Yopilgan) arizalar',
        formula: `COUNTIF('Arizalar ro''yxati'!D2:D${maxAppRow}, "*Hal*")`,
      },
      {
        label: 'Rad etilgan arizalar',
        formula: `COUNTIF('Arizalar ro''yxati'!D2:D${maxAppRow}, "*Rad*")`,
      },
    ];

    statusRows.forEach((st) => {
      const r = ws.getRow(curRow);
      r.getCell(2).value = st.label;
      r.getCell(2).font = { name: 'Segoe UI', size: 10 };

      const valCell = r.getCell(3);
      valCell.value = { formula: st.formula };
      valCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: '1E3A8A' } };
      valCell.numFmt = '#,##0';
      valCell.alignment = { horizontal: 'right' };

      r.getCell(4).value = 'ta';
      r.getCell(4).font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: '64748B' } };

      r.height = 22;
      this.applyBorder(r, 2, 4);
      curRow++;
    });
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  private extractAllTransfers(app: Application): any[] {
    const list: any[] = [];
    if (app.transfer) {
      list.push(app.transfer);
    }
    if (Array.isArray(app.custom_fields)) {
      for (const cf of app.custom_fields) {
        if (cf.transfer) {
          list.push(cf.transfer);
        }
      }
    }
    return list;
  }

  private extractSuspectItems(nodes: any): Array<{ label: string; value: string; note: string }> {
    const result: Array<{ label: string; value: string; note: string }> = [];
    if (!Array.isArray(nodes)) return result;

    for (const node of nodes) {
      if (node && (node.value || node.label)) {
        result.push({
          label: node.label || 'Belgi',
          value: node.value || '—',
          note: node.note || '',
        });
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        result.push(...this.extractSuspectItems(node.children));
      }
    }
    return result;
  }

  private styleHeaderRow(row: ExcelJS.Row, hexColor: string): void {
    row.height = 28;
    row.eachCell((cell) => {
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexColor } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'CBD5E1' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        bottom: { style: 'medium', color: { argb: '0F172A' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } },
      };
    });
  }

  private styleDataRow(row: ExcelJS.Row, index: number): void {
    row.height = 22;
    const isOdd = index % 2 === 1;
    const bgArgb = isOdd ? 'F8FAFC' : 'FFFFFF';

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Segoe UI', size: 9.5 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } },
      };
    });
  }

  private applyBorder(row: ExcelJS.Row, startCol: number, endCol: number): void {
    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      cell.border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } },
      };
    }
  }
}
