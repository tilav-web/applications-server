import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import {
  applyExcelAutoFilter,
  escapeExcelCriteriaLiteral,
  formatDestinationType,
  formatTransferDateTime,
  formatTransferStatus,
  sanitizeExcelRow,
  sanitizeExcelValue,
  styleExcelDataRow,
  styleExcelHeaderRow,
  styleExcelSubTotalRow,
  styleExcelTotalRow,
} from '../../../common/utils/excel-style.util';
import { Application } from '../application.entity';
import type { Transfer } from '../transfers/transfer.entity';

interface TransferItem {
  id?: string;
  amount?: number | string | null;
  currency?: string | null;
  transfer_date?: string | Date | null;
  transfer_time?: string | null;
  created_at?: string | Date | null;
  status?: string | null;
  destination_type?: string | null;
  destination_label?: string | null;
  receiver_identifier?: { raw_value?: string | null; value?: string | null } | null;
  sender_card?: {
    card_number?: string | null;
    masked_number?: string | null;
    bank?: { name?: string | null } | null;
  } | null;
  sender_bank_name?: string | null;
  receiver_card?: {
    card_number?: string | null;
    masked_number?: string | null;
    full_name?: string | null;
    bank?: { name?: string | null } | null;
    citizen?: {
      first_name?: string | null;
      last_name?: string | null;
      middle_name?: string | null;
    } | null;
  } | null;
  receiver_bank_name?: string | null;
  receiver_name?: string | null;
  payment_provider?: { name?: string | null } | null;
  provider_name?: string | null;
}

interface SuspectNodeItem {
  label?: string;
  value?: string;
  note?: string;
  children?: SuspectNodeItem[];
}

@Injectable()
export class ApplicationsExcelService {
  generateWorkbook(
    applications: Application[],
    extraTransfersMap?: Map<string, Transfer[]>,
  ): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();
    workbook.modified = new Date();

    const totalApps = applications.length;
    const allTransfersCount = applications.reduce(
      (cnt, app) => cnt + this.extractAllTransfers(app, extraTransfersMap).length,
      0,
    );
    const allSuspectsCount = applications.reduce(
      (cnt, app) => cnt + this.extractSuspectItems(app.suspect_tree).length,
      0,
    );

    // 1. Sheet 1: Arizalar ro'yxati (Bosh jadval)
    this.buildApplicationsSheet(workbook, applications);

    // 2. Sheet 2: Pul o'tkazmalari (Barcha asosiy + qo'shimcha + tranzit tranzaksiyalar)
    this.buildTransfersSheet(workbook, applications, extraTransfersMap);

    // 3. Sheet 3: Gumonlanuvchilar (Raqamli identifikatorlar)
    this.buildSuspectsSheet(workbook, applications);

    // 4. Sheet 4: Xulosa va Statistika (Dinamik JPK status va hudud formulalari)
    this.buildSummarySheet(workbook, applications, totalApps, allTransfersCount, allSuspectsCount);

    return Promise.resolve(workbook);
  }

  /**
   * 1-SHEET: Arizalar ro'yxati (Bosh jadval)
   */
  private buildApplicationsSheet(workbook: ExcelJS.Workbook, applications: Application[]): void {
    const ws = workbook.addWorksheet("Arizalar ro'yxati", {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // Dinamik jinoyat usuli maydonlarini (show_in_excel = true) yig'amiz
    const dynamicColumnsMap = new Map<
      string,
      { key: string; header: string; sort_order: number }
    >();
    for (const app of applications) {
      const methodFields = app.crime_method?.fields || [];
      for (const f of methodFields) {
        if (f.is_active !== false && f.show_in_excel !== false && f.key) {
          if (!dynamicColumnsMap.has(f.key)) {
            dynamicColumnsMap.set(f.key, {
              key: f.key,
              header: f.excel_header || f.label,
              sort_order: f.sort_order ?? 0,
            });
          }
        }
      }
      for (const cf of app.custom_fields || []) {
        if (cf.key && cf.key.startsWith('method_') && !dynamicColumnsMap.has(cf.key)) {
          dynamicColumnsMap.set(cf.key, {
            key: cf.key,
            header: cf.label || cf.key,
            sort_order: cf.order ?? 999,
          });
        }
      }
    }
    const dynamicColumns = Array.from(dynamicColumnsMap.values()).sort(
      (a, b) => a.sort_order - b.sort_order,
    );

    ws.columns = [
      { header: '№', key: 'idx', width: 6 }, // A (1)
      { header: 'Ariza Raqami', key: 'app_num', width: 20 }, // B (2)
      { header: 'Ariza Sanasi', key: 'date', width: 13 }, // C (3)
      { header: 'Murojaat Manbasi', key: 'source', width: 18 }, // D (4)
      { header: 'Holati (JPK)', key: 'status', width: 24 }, // E (5)
      { header: 'Hudud (Tuman)', key: 'district', width: 18 }, // F (6)
      { header: 'Mahalla', key: 'mahalla', width: 22 }, // G (7)
      { header: 'Jinoyat Moddasi', key: 'crime', width: 24 }, // H (8)
      { header: 'Jinoyat Usuli', key: 'crime_method', width: 28 }, // I (9)
      { header: 'Arizachi (F.I.SH)', key: 'citizen_name', width: 28 }, // J (10)
      { header: 'Jinsi', key: 'gender', width: 10 }, // K (11)
      { header: 'Telefon Raqam', key: 'phone', width: 18 }, // L (12)
      { header: 'Pasport Seriya', key: 'passport', width: 15 }, // M (13)
      { header: 'JShShIR (PINFL)', key: 'pinfl', width: 18 }, // N (14)
      { header: 'Yashash Manzili', key: 'address', width: 32 }, // O (15)
      { header: 'Kasb Toifasi', key: 'occ_category', width: 24 }, // P (16)
      { header: 'Kasb Turi', key: 'occupation', width: 24 }, // Q (17)
      { header: 'Ish Joyi / Tashkilot', key: 'workplace', width: 30 }, // R (18)
      { header: 'Lavozimi', key: 'work_position', width: 22 }, // S (19)
      { header: "O'tkazmalar Soni", key: 'transfers_count', width: 16 }, // T (20)
      { header: "Zarar Miqdori (so'm)", key: 'total_amount', width: 22 }, // U (21)
      { header: 'Gumonlanuvchilar', key: 'suspects_count', width: 16 }, // V (22)
      { header: "Bog'langan Arizalar", key: 'relations', width: 24 }, // W (23)
      { header: 'Sohaviy Xizmat', key: 'department_service', width: 20 }, // X (24)
      { header: 'Protsessual Muddat (SLA)', key: 'sla_deadline', width: 22 }, // Y (25)
      { header: 'Yakuniy Qaror / Raqami', key: 'decision', width: 26 }, // Z (26)
      { header: "Mas'ul Ijrochi", key: 'officer', width: 22 }, // AA (27)
      { header: 'Tafsilot (Fabula)', key: 'description', width: 45 }, // AB (28)
      { header: 'Xodim Qaydlari', key: 'notes', width: 32 }, // AC (29)
      ...dynamicColumns.map((col) => ({
        header: col.header,
        key: `dyn_${col.key}`,
        width: 24,
      })),
    ];

    styleExcelHeaderRow(ws.getRow(1));
    applyExcelAutoFilter(ws, 1);

    applications.forEach((app, index) => {
      const rowNum = index + 2;
      const citizen = app.citizen;
      const citizenName = citizen
        ? [citizen.last_name, citizen.first_name, citizen.middle_name].filter(Boolean).join(' ')
        : '—';

      const dateStr = app.date
        ? new Date(app.date).toISOString().slice(0, 10)
        : app.created_at
          ? new Date(app.created_at).toISOString().slice(0, 10)
          : '—';

      const statusName = app.application_status?.name || app.status || 'Yangi';
      const appNumber = app.application_number || `AR-${app.id.slice(0, 8)}`;

      const transfersFormula = `COUNTIF('Pul o''tkazmalari'!$B:$B, B${rowNum})`;
      const amountFormula = `SUMIFS('Pul o''tkazmalari'!$F:$F, 'Pul o''tkazmalari'!$B:$B, B${rowNum}, 'Pul o''tkazmalari'!$G:$G, "UZS")`;
      const suspectsFormula = `COUNTIF('Gumonlanuvchilar'!$B:$B, B${rowNum})`;

      const dynamicRowData: Record<string, string> = {};
      if (dynamicColumns.length > 0) {
        const cfByKey = new Map<string, unknown>();
        for (const cf of app.custom_fields || []) {
          if (cf.key) {
            cfByKey.set(cf.key, cf.value);
          }
        }
        for (const col of dynamicColumns) {
          const val = cfByKey.get(col.key);
          if (val === null || val === undefined || val === '') {
            dynamicRowData[`dyn_${col.key}`] = '—';
          } else if (Array.isArray(val)) {
            dynamicRowData[`dyn_${col.key}`] = val.join(', ');
          } else if (typeof val === 'object') {
            dynamicRowData[`dyn_${col.key}`] = JSON.stringify(val);
          } else if (
            typeof val === 'string' ||
            typeof val === 'number' ||
            typeof val === 'boolean'
          ) {
            dynamicRowData[`dyn_${col.key}`] = String(val);
          } else {
            dynamicRowData[`dyn_${col.key}`] = '—';
          }
        }
      }

      const relSummary = app.relations_summary;
      const relationsStr =
        relSummary && relSummary.total > 0
          ? `${relSummary.total} ta${relSummary.has_fraud_card_link ? ' (Firibgar kartasi)' : ''}`
          : '—';

      const officerStr = app.created_by
        ? [app.created_by.last_name, app.created_by.first_name].filter(Boolean).join(' ') || '—'
        : '—';

      const workplaceStr = app.workplace?.name || citizen?.workplace?.name || '—';
      const workPositionStr = app.work_position || citizen?.work_position || '—';
      const deptServiceStr =
        app.department_service?.short_name || app.department_service?.name || '—';
      const slaDeadlineStr = app.deadline_at
        ? `${new Date(app.deadline_at).toISOString().slice(0, 10)}${
            app.extended_until
              ? ` (Uzaytirilgan: ${app.sla_days || 30} kun)`
              : app.sla_days
                ? ` (${app.sla_days} kun)`
                : ''
          }`
        : '—';
      const decisionStr = app.decision_type?.name
        ? `${app.decision_type.name}${app.decision_number ? ` (№ ${app.decision_number})` : ''}`
        : app.decision_number
          ? `№ ${app.decision_number}`
          : '—';

      const row = ws.addRow(
        sanitizeExcelRow({
          idx: index + 1,
          app_num: appNumber,
          date: dateStr,
          source: app.source?.name || '—',
          status: statusName,
          district: app.district?.name || citizen?.district?.name || '—',
          mahalla: citizen?.mahalla?.name || '—',
          crime: app.crime ? app.crime.article || app.crime.title : '—',
          crime_method: app.crime_method?.name || '—',
          citizen_name: citizenName,
          gender:
            citizen?.gender === 'female' ? 'Ayol' : citizen?.gender === 'male' ? 'Erkak' : '—',
          phone: citizen?.phone_number || '—',
          passport: citizen?.passport || '—',
          pinfl: citizen?.pinfl || '—',
          address: citizen?.address || '—',
          occ_category: citizen?.occupation_category?.name || '—',
          occupation: citizen?.occupation?.name || '—',
          workplace: workplaceStr,
          work_position: workPositionStr,
          transfers_count: { formula: transfersFormula },
          total_amount: { formula: amountFormula },
          suspects_count: { formula: suspectsFormula },
          relations: relationsStr,
          department_service: deptServiceStr,
          sla_deadline: slaDeadlineStr,
          decision: decisionStr,
          officer: officerStr,
          description: app.description || '—',
          notes: app.officer_notes || '—',
          ...dynamicRowData,
        }),
      );

      styleExcelDataRow(row, ['address', 'description', 'notes']);

      row.getCell('app_num').numFmt = '@';
      row.getCell('phone').numFmt = '@';
      row.getCell('passport').numFmt = '@';
      row.getCell('pinfl').numFmt = '@';

      const amountCell = row.getCell('total_amount');
      amountCell.numFmt = '#,##0.00';
      amountCell.alignment = { horizontal: 'right', vertical: 'middle' };

      const countCell = row.getCell('transfers_count');
      countCell.numFmt = '#,##0';
      countCell.alignment = { horizontal: 'center', vertical: 'middle' };

      const suspectCell = row.getCell('suspects_count');
      suspectCell.numFmt = '#,##0';
      suspectCell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const summaryRow = ws.addRow({
        work_position: 'JAMI:',
        transfers_count: { formula: `SUM(T2:T${lastDataRow})` },
        total_amount: { formula: `SUM(U2:U${lastDataRow})` },
        suspects_count: { formula: `SUM(V2:V${lastDataRow})` },
      });

      styleExcelTotalRow(summaryRow);
      summaryRow.getCell('work_position').alignment = { horizontal: 'right', vertical: 'middle' };
      summaryRow.getCell('transfers_count').numFmt = '#,##0';
      summaryRow.getCell('transfers_count').alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      summaryRow.getCell('total_amount').numFmt = '#,##0.00';
      summaryRow.getCell('total_amount').alignment = { horizontal: 'right', vertical: 'middle' };
      summaryRow.getCell('suspects_count').numFmt = '#,##0';
      summaryRow.getCell('suspects_count').alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
    }
  }

  /**
   * 2-SHEET: Pul o'tkazmalari (Barcha asosiy va qo'shimcha/tranzit o'tkazmalar)
   */
  private buildTransfersSheet(
    workbook: ExcelJS.Workbook,
    applications: Application[],
    extraTransfersMap?: Map<string, Transfer[]>,
  ): void {
    const ws = workbook.addWorksheet("Pul o'tkazmalari", {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 }, // A
      { header: 'Ariza Raqami', key: 'app_num', width: 20 }, // B
      { header: 'Arizachi F.I.SH', key: 'citizen_name', width: 28 }, // C
      { header: 'Jabrlanuvchi Kartasi', key: 'sender_card', width: 22 }, // D
      { header: "Xizmat Ko'rsatuvchi Bank", key: 'sender_bank', width: 24 }, // E
      { header: "O'tkazma Summasi", key: 'amount', width: 22 }, // F
      { header: 'Valyuta', key: 'currency', width: 10 }, // G
      { header: "To'lov Provayderi / Ilova", key: 'provider', width: 22 }, // H
      { header: "O'tkazma Sanasi va Vaqti", key: 'transfer_date', width: 18 }, // I
      { header: 'Chiqish Kanali', key: 'dest_type', width: 20 }, // J
      { header: 'Qabul Qiluvchi Karta / Rekvizit', key: 'receiver_card', width: 28 }, // K
      { header: 'Qabul Qiluvchi Banki', key: 'receiver_bank', width: 24 }, // L
      { header: 'Qabul Qiluvchi F.I.SH / Nomi', key: 'receiver_name', width: 28 }, // M
      { header: 'Holati', key: 'status', width: 16 }, // N
    ];

    styleExcelHeaderRow(ws.getRow(1));
    applyExcelAutoFilter(ws, 1);

    let transferIndex = 0;
    for (const app of applications) {
      const citizenName = app.citizen
        ? [app.citizen.last_name, app.citizen.first_name, app.citizen.middle_name]
            .filter(Boolean)
            .join(' ')
        : '—';

      const transfers = this.extractAllTransfers(app, extraTransfersMap);
      const appNumber = app.application_number || `AR-${app.id.slice(0, 8)}`;

      for (const t of transfers) {
        transferIndex++;
        const senderCard = t.sender_card?.card_number || t.sender_card?.masked_number || '—';
        const senderBank = t.sender_card?.bank?.name || t.sender_bank_name || '—';
        const receiverCard =
          t.receiver_card?.card_number ||
          t.receiver_card?.masked_number ||
          t.receiver_identifier?.raw_value ||
          t.receiver_identifier?.value ||
          t.destination_label ||
          '—';
        const receiverBank = t.receiver_card?.bank?.name || t.receiver_bank_name || '—';
        const receiverName =
          t.receiver_card?.full_name ||
          (t.receiver_card?.citizen
            ? [
                t.receiver_card.citizen.last_name,
                t.receiver_card.citizen.first_name,
                t.receiver_card.citizen.middle_name,
              ]
                .filter(Boolean)
                .join(' ')
            : '') ||
          t.receiver_name ||
          t.destination_label ||
          '—';

        const row = ws.addRow(
          sanitizeExcelRow({
            idx: transferIndex,
            app_num: appNumber,
            citizen_name: citizenName,
            sender_card: senderCard,
            sender_bank: senderBank,
            amount: Number(t.amount) || 0,
            currency: t.currency || 'UZS',
            provider: t.payment_provider?.name || t.provider_name || '—',
            transfer_date: formatTransferDateTime(t.transfer_date, t.transfer_time, t.created_at),
            dest_type: formatDestinationType(t.destination_type),
            receiver_card: receiverCard,
            receiver_bank: receiverBank,
            receiver_name: receiverName,
            status: formatTransferStatus(t.status),
          }),
        );

        styleExcelDataRow(row);

        row.getCell('app_num').numFmt = '@';
        row.getCell('sender_card').numFmt = '@';
        row.getCell('receiver_card').numFmt = '@';

        const amountCell = row.getCell('amount');
        amountCell.numFmt = '#,##0.00';
        amountCell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const totalRow = ws.addRow({
        sender_bank: 'JAMI ZARAR (UZS):',
        amount: { formula: `SUMIF(G2:G${lastDataRow}, "UZS", F2:F${lastDataRow})` },
        currency: 'UZS',
      });

      styleExcelTotalRow(totalRow);
      totalRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      const avgRow = ws.addRow({
        sender_bank: "O'RTACHA ZARAR (UZS):",
        amount: { formula: `IFERROR(AVERAGEIF(G2:G${lastDataRow}, "UZS", F2:F${lastDataRow}), 0)` },
        currency: 'UZS',
      });
      styleExcelSubTotalRow(avgRow);
      avgRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      avgRow.getCell('amount').numFmt = '#,##0.00';
      avgRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      const countRow = ws.addRow({
        sender_bank: "O'TKAZMALAR SONI:",
        amount: { formula: `COUNT(F2:F${lastDataRow})` },
        currency: 'ta',
      });
      styleExcelSubTotalRow(countRow);
      countRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      countRow.getCell('amount').numFmt = '#,##0';
      countRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
    }
  }

  /**
   * 3-SHEET: Gumonlanuvchilar belgilari
   */
  private buildSuspectsSheet(workbook: ExcelJS.Workbook, applications: Application[]): void {
    const ws = workbook.addWorksheet('Gumonlanuvchilar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'app_num', width: 20 },
      { header: 'Jinoyat Moddasi', key: 'crime', width: 24 },
      { header: 'Belgi / Maydon Nomi', key: 'field_name', width: 24 },
      { header: 'Identifikator Qiymati', key: 'field_value', width: 32 },
      { header: 'Izoh / Tavsif', key: 'note', width: 35 },
      { header: 'Qayd Sanasi', key: 'created_at', width: 16 },
    ];

    styleExcelHeaderRow(ws.getRow(1));
    applyExcelAutoFilter(ws, 1);

    let suspectIndex = 0;
    for (const app of applications) {
      const suspectItems = this.extractSuspectItems(app.suspect_tree);
      const dateStr = app.created_at ? new Date(app.created_at).toISOString().slice(0, 10) : '—';
      const crimeStr = app.crime ? app.crime.article || app.crime.title : '—';
      const appNumber = app.application_number || `AR-${app.id.slice(0, 8)}`;

      for (const item of suspectItems) {
        suspectIndex++;
        const row = ws.addRow(
          sanitizeExcelRow({
            idx: suspectIndex,
            app_num: appNumber,
            crime: crimeStr,
            field_name: item.label,
            field_value: item.value,
            note: item.note || '—',
            created_at: dateStr,
          }),
        );

        styleExcelDataRow(row, ['note']);

        row.getCell('app_num').numFmt = '@';
        const valCell = row.getCell('field_value');
        valCell.numFmt = '@';
        valCell.font = {
          name: 'Calibri',
          size: 10,
          bold: true,
          color: { argb: '000000' },
        };
      }
    }

    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const totalRow = ws.addRow({
        field_name: 'JAMI IDENTIFIKATORLAR:',
        field_value: { formula: `COUNTA(E2:E${lastDataRow})` },
        note: 'ta rekvizit',
      });

      styleExcelTotalRow(totalRow);
      totalRow.getCell('field_name').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('field_value').numFmt = '#,##0';
      totalRow.getCell('field_value').alignment = { horizontal: 'left', vertical: 'middle' };
    }
  }

  /**
   * 4-SHEET: Xulosa va Statistika (Barcha dinamik JPK statuslar va tumanlar bo'yicha formulalar)
   */
  private buildSummarySheet(
    workbook: ExcelJS.Workbook,
    applications: Application[],
    appCount: number,
    transferCount: number,
    suspectCount: number,
  ): void {
    const ws = workbook.addWorksheet('Xulosa va Statistika');

    ws.columns = [{ width: 5 }, { width: 44 }, { width: 22 }, { width: 14 }, { width: 28 }];

    ws.mergeCells('B2:E2');
    const titleCell = ws.getCell('B2');
    titleCell.value = '«ARIZALAR VA MUROJAATLAR» TIZIMI TAHLILIY HISOBOTI';
    titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: '000000' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    this.applyBorder(ws.getRow(2), 2, 5);
    ws.getRow(2).height = 32;

    ws.mergeCells('B3:E3');
    const subTitle = ws.getCell('B3');
    subTitle.value = `Hisobot shakllantirilgan sana: ${new Date().toLocaleString('uz-UZ')}`;
    subTitle.font = { name: 'Calibri', size: 9, italic: true, color: { argb: '334155' } };
    subTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(3).height = 20;

    let curRow = 5;
    const sec1 = ws.getCell(`B${curRow}`);
    sec1.value = "1. ASOSIY UMUMIY VA MOLIYAVIY KO'RSATKICHLAR";
    sec1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: '000000' } };
    curRow++;

    const maxAppRow = Math.max(appCount + 1, 2);
    const maxTransferRow = Math.max(transferCount + 1, 2);
    const maxSuspectRow = Math.max(suspectCount + 1, 2);

    const kpiRows = [
      {
        title: 'Jami arizalar soni',
        formula: `COUNTA('Arizalar ro''yxati'!B2:B${maxAppRow})`,
        unit: 'ta ariza',
        format: '#,##0',
      },
      {
        title: "Jami noqonuniy pul o'tkazmalari",
        formula: `COUNT('Pul o''tkazmalari'!F2:F${maxTransferRow})`,
        unit: 'ta tranzaksiya',
        format: '#,##0',
      },
      {
        title: 'Jami yetkazilgan moddiy zarar (UZS)',
        formula: `SUMIF('Pul o''tkazmalari'!G2:G${maxTransferRow}, "UZS", 'Pul o''tkazmalari'!F2:F${maxTransferRow})`,
        unit: "so'm (UZS)",
        format: '#,##0.00',
      },
      {
        title: "O'rtacha bitta o'tkazma zarari (UZS)",
        formula: `IFERROR(AVERAGEIF('Pul o''tkazmalari'!G2:G${maxTransferRow}, "UZS", 'Pul o''tkazmalari'!F2:F${maxTransferRow}), 0)`,
        unit: "so'm (UZS)",
        format: '#,##0.00',
      },
      {
        title: 'Aniqlangan gumonlanuvchilar belgilari',
        formula: `COUNTA('Gumonlanuvchilar'!B2:B${maxSuspectRow})`,
        unit: 'ta rekvizit',
        format: '#,##0',
      },
    ];

    kpiRows.forEach((kpi) => {
      const r = ws.getRow(curRow);
      r.getCell(2).value = kpi.title;
      r.getCell(2).font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };

      const valCell = r.getCell(3);
      valCell.value = { formula: kpi.formula };
      valCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: '000000' } };
      valCell.numFmt = kpi.format;
      valCell.alignment = { horizontal: 'right', vertical: 'middle' };

      r.getCell(4).value = kpi.unit;
      r.getCell(4).font = { name: 'Calibri', size: 9, italic: true, color: { argb: '475569' } };
      r.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };

      r.height = 24;
      this.applyBorder(r, 2, 4);
      curRow++;
    });

    // Bo'lim 2: Haqiqiy JPK statuslar bo'yicha dinamik taqsimot (E ustuni)
    curRow += 2;
    const sec2 = ws.getCell(`B${curRow}`);
    sec2.value = "2. ARIZALARNING HOLATLAR (JPK STATUSLAR) BO'YICHA TAQSIMOTI";
    sec2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: '000000' } };
    curRow++;

    const statusSet = new Set<string>();
    for (const app of applications) {
      statusSet.add(app.application_status?.name || app.status || 'Yangi');
    }
    const statusList =
      statusSet.size > 0
        ? Array.from(statusSet)
        : [
            'Yangi (Qabul qilindi)',
            'Tergovga qadar tekshiruvda',
            "Jinoyat ishi qo'zg'atildi",
            "Jinoyat ishi qo'zg'atish rad etildi",
          ];

    statusList.forEach((statusName) => {
      const r = ws.getRow(curRow);
      r.getCell(2).value = sanitizeExcelValue(statusName);
      r.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: '000000' } };

      const safeStatus = escapeExcelCriteriaLiteral(statusName);
      const valCell = r.getCell(3);
      valCell.value = {
        formula: `COUNTIF('Arizalar ro''yxati'!E2:E${maxAppRow}, "${safeStatus}")`,
      };
      valCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      valCell.numFmt = '#,##0';
      valCell.alignment = { horizontal: 'right', vertical: 'middle' };

      r.getCell(4).value = 'ta';
      r.getCell(4).font = { name: 'Calibri', size: 9, italic: true, color: { argb: '475569' } };
      r.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };

      r.height = 22;
      this.applyBorder(r, 2, 4);
      curRow++;
    });

    // Bo'lim 3: Tumanlar (Hududlar) kesimidagi tahlil (F ustuni = tuman, U ustuni = zarar)
    curRow += 2;
    const sec3 = ws.getCell(`B${curRow}`);
    sec3.value = "3. HUDUDLAR (TUMANLAR) BO'YICHA ARIZALAR VA ZARAR TAHLILI";
    sec3.font = { name: 'Calibri', size: 11, bold: true, color: { argb: '000000' } };
    curRow++;

    const distHeaderRow = ws.getRow(curRow);
    distHeaderRow.getCell(2).value = 'Tuman / Shahar';
    distHeaderRow.getCell(3).value = 'Arizalar soni';
    distHeaderRow.getCell(4).value = 'Birligi';
    distHeaderRow.getCell(5).value = "Zarar miqdori (so'm)";
    distHeaderRow.height = 24;
    distHeaderRow.eachCell((c) => {
      c.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: '000000' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = {
        top: { style: 'thin', color: { argb: '94A3B8' } },
        bottom: { style: 'medium', color: { argb: '000000' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } },
      };
    });
    curRow++;

    const districtSet = new Set<string>();
    applications.forEach((app) => {
      const d = app.district?.name || app.citizen?.district?.name;
      if (d) districtSet.add(d);
    });

    const districtsList =
      districtSet.size > 0
        ? Array.from(districtSet).sort()
        : [
            'Qarshi sh.',
            'Qarshi t.',
            'Kitob t.',
            'Kasbi t.',
            'Koson t.',
            'Nishon t.',
            'Chiroqchi t.',
            'Shahrisabz sh.',
            'Shahrisabz t.',
            "Yakkabog' t.",
            "G'uzor t.",
            'Dehqonobod t.',
            'Qamashi t.',
            'Muborak t.',
            'Mirishkor t.',
            "Ko'kdala t.",
          ];

    districtsList.forEach((districtName) => {
      const r = ws.getRow(curRow);
      r.getCell(2).value = sanitizeExcelValue(districtName);
      r.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: '000000' } };

      const safeDistrict = escapeExcelCriteriaLiteral(districtName);
      const valCell = r.getCell(3);
      valCell.value = {
        formula: `COUNTIF('Arizalar ro''yxati'!F2:F${maxAppRow}, "${safeDistrict}")`,
      };
      valCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      valCell.numFmt = '#,##0';
      valCell.alignment = { horizontal: 'right', vertical: 'middle' };

      r.getCell(4).value = 'ta';
      r.getCell(4).font = { name: 'Calibri', size: 9, italic: true, color: { argb: '475569' } };
      r.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };

      const distAmountCell = r.getCell(5);
      distAmountCell.value = {
        formula: `SUMIF('Arizalar ro''yxati'!F2:F${maxAppRow}, "${safeDistrict}", 'Arizalar ro''yxati'!U2:U${maxAppRow})`,
      };
      distAmountCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      distAmountCell.numFmt = '#,##0.00';
      distAmountCell.alignment = { horizontal: 'right', vertical: 'middle' };

      r.height = 22;
      this.applyBorder(r, 2, 5);
      curRow++;
    });
  }

  private extractAllTransfers(
    app: Application,
    extraTransfersMap?: Map<string, Transfer[]>,
  ): TransferItem[] {
    const list: TransferItem[] = [];
    const seenIds = new Set<string>();

    const pushUnique = (t?: TransferItem | null) => {
      if (!t) return;
      if (t.id) {
        if (seenIds.has(t.id)) return;
        seenIds.add(t.id);
      }
      list.push(t);
    };

    pushUnique(app.transfer);
    if (Array.isArray(app.custom_fields)) {
      for (const cf of app.custom_fields) {
        if (cf.transfer) {
          pushUnique(cf.transfer);
        }
      }
    }
    const linked = extraTransfersMap?.get(app.id) || [];
    for (const tr of linked) {
      pushUnique(tr);
    }

    return list;
  }

  private extractSuspectItems(
    nodes: unknown,
  ): Array<{ label: string; value: string; note: string }> {
    const result: Array<{ label: string; value: string; note: string }> = [];
    if (!Array.isArray(nodes)) return result;

    for (const node of nodes as SuspectNodeItem[]) {
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

  private applyBorder(row: ExcelJS.Row, startCol: number, endCol: number): void {
    for (let c = startCol; c <= endCol; c++) {
      const cell = row.getCell(c);
      cell.border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } },
      };
    }
  }
}
