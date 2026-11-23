import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { Application } from '../application.entity';

interface TransferItem {
  amount?: number | string | null;
  currency?: string | null;
  transfer_date?: string | Date | null;
  status?: string | null;
  sender_card?: {
    card_number?: string | null;
    bank?: { name?: string | null } | null;
  } | null;
  sender_bank_name?: string | null;
  receiver_card?: {
    card_number?: string | null;
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
  generateWorkbook(applications: Application[]): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arizalar bazasi';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Hisob-kitoblar va qator chegaralari
    const totalApps = applications.length;
    const allTransfersCount = applications.reduce(
      (cnt, app) => cnt + this.extractAllTransfers(app).length,
      0,
    );
    const allSuspectsCount = applications.reduce(
      (cnt, app) => cnt + this.extractSuspectItems(app.suspect_tree).length,
      0,
    );

    // 1. Sheet 1: Arizalar ro'yxati (Bosh jadval)
    this.buildApplicationsSheet(workbook, applications);

    // 2. Sheet 2: Pul o'tkazmalari (Barcha tranzaksiyalar)
    this.buildTransfersSheet(workbook, applications);

    // 3. Sheet 3: Gumonlanuvchilar (Raqamli identifikatorlar)
    this.buildSuspectsSheet(workbook, applications);

    // 4. Sheet 4: Xulosa va Statistika (Dinamik formulalar)
    this.buildSummarySheet(workbook, applications, totalApps, allTransfersCount, allSuspectsCount);

    return Promise.resolve(workbook);
  }

  /**
   * 1-SHEET: Arizalar ro'yxati (Bosh jadval)
   * Har bir arizaning o'tkazmalar soni va zarar miqdori 2-tabdan dinamik SUMIF / COUNTIF formulasi orqali hisoblanadi!
   */
  private buildApplicationsSheet(workbook: ExcelJS.Workbook, applications: Application[]): void {
    const ws = workbook.addWorksheet("Arizalar ro'yxati", {
      views: [{ state: 'frozen', ySplit: 1 }],
      // Qat'iy oq-qora qoida: hech qanday tabColor ishlatilmaydi
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
      // Agar custom_fields ichida method_ prefiksli qiymat bo'lsa ham ustunga qo'shamiz
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
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'app_num', width: 22 },
      { header: 'Ariza Sanasi', key: 'date', width: 14 },
      { header: 'Holati', key: 'status', width: 18 },
      { header: 'Hudud (Tuman)', key: 'district', width: 18 },
      { header: 'Mahalla', key: 'mahalla', width: 20 },
      { header: 'Jinoyat Moddasi', key: 'crime', width: 24 },
      { header: 'Jinoyat Usuli', key: 'crime_method', width: 28 },
      { header: 'Arizachi (F.I.SH)', key: 'citizen_name', width: 28 },
      { header: 'Jinsi', key: 'gender', width: 10 },
      { header: 'Telefon Raqam', key: 'phone', width: 18 },
      { header: 'Pasport Seriya', key: 'passport', width: 16 },
      { header: 'JShShIR (PINFL)', key: 'pinfl', width: 18 },
      { header: 'Yashash Manzili', key: 'address', width: 35 },
      { header: "O'tkazmalar Soni", key: 'transfers_count', width: 18 },
      { header: "Zarar Miqdori (so'm)", key: 'total_amount', width: 24 },
      { header: 'Gumonlanuvchilar', key: 'suspects_count', width: 18 },
      { header: 'Tafsilot (Fabula)', key: 'description', width: 45 },
      { header: 'Xodim Qaydlari', key: 'notes', width: 35 },
      { header: 'Kasbi / Sohasi', key: 'occupation', width: 24 },
      { header: 'Ish joyi / Tashkilot', key: 'workplace', width: 28 },
      { header: 'Lavozimi', key: 'work_position', width: 20 },
      { header: 'Sohaviy xizmat', key: 'department_service', width: 22 },
      { header: 'Protsessual muddat (SLA)', key: 'sla_deadline', width: 24 },
      { header: 'Yakuniy qaror / Raqami', key: 'decision', width: 28 },
      ...dynamicColumns.map((col) => ({
        header: col.header,
        key: `dyn_${col.key}`,
        width: 24,
      })),
    ];

    // Monoxrom audit sarlavhasi
    this.styleHeaderRow(ws.getRow(1));

    applications.forEach((app, index) => {
      const rowNum = index + 2; // Sarlavha 1-qator bo'lgani uchun ma'lumotlar 2-qatordan boshlanadi
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
      const appNumber = app.application_number || `AR-${app.id}`;

      // Relyatsion professional formulalar:
      // O'tkazmalar soni: 2-tabdagi 'Pul o'tkazmalari' B ustunida ushbu ariza raqamini sanaydi
      const transfersFormula = `COUNTIF('Pul o''tkazmalari'!$B:$B, B${rowNum})`;

      // Zarar miqdori: 2-tabdagi 'Pul o'tkazmalari' B ustunida mos ariza raqamining F (summa) ustunini yig'adi
      const amountFormula = `SUMIF('Pul o''tkazmalari'!$B:$B, B${rowNum}, 'Pul o''tkazmalari'!$F:$F)`;

      // Gumonlanuvchilar soni: 3-tabdagi 'Gumonlanuvchilar' B ustunida mos ariza raqamini sanaydi
      const suspectsFormula = `COUNTIF('Gumonlanuvchilar'!$B:$B, B${rowNum})`;

      // Dinamik maydon qiymatlarini ushbu arizaning custom_fields laridan olamiz
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

      const occupationStr =
        [citizen?.occupation_category?.name, citizen?.occupation?.name]
          .filter(Boolean)
          .join(' — ') || '—';
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

      const row = ws.addRow({
        idx: index + 1,
        app_num: appNumber,
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
        transfers_count: { formula: transfersFormula },
        total_amount: { formula: amountFormula },
        suspects_count: { formula: suspectsFormula },
        description: app.description || '—',
        notes: app.officer_notes || '—',
        occupation: occupationStr,
        workplace: workplaceStr,
        work_position: workPositionStr,
        department_service: deptServiceStr,
        sla_deadline: slaDeadlineStr,
        decision: decisionStr,
        ...dynamicRowData,
      });

      this.styleDataRow(row);

      // Karta, PINFL, Telefon, Ariza raqami - har doim matn formatida (@)
      row.getCell('app_num').numFmt = '@';
      row.getCell('phone').numFmt = '@';
      row.getCell('passport').numFmt = '@';
      row.getCell('pinfl').numFmt = '@';

      // Raqamlar va formulalar formatlash
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

    // Tagidagi JAMI qatori (Buxgalteriya ikki qatorli double pastki chizig'i bilan)
    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const summaryRow = ws.addRow({
        idx: '',
        app_num: '',
        date: '',
        status: '',
        district: '',
        mahalla: '',
        crime: '',
        crime_method: '',
        citizen_name: '',
        gender: '',
        phone: '',
        passport: '',
        pinfl: '',
        address: 'JAMI:',
        transfers_count: { formula: `SUM(O2:O${lastDataRow})` },
        total_amount: { formula: `SUM(P2:P${lastDataRow})` },
        suspects_count: { formula: `SUM(Q2:Q${lastDataRow})` },
        description: '',
        notes: '',
      });

      this.styleTotalRow(summaryRow);

      summaryRow.getCell('address').alignment = { horizontal: 'right', vertical: 'middle' };
      summaryRow.getCell('transfers_count').numFmt = '#,##0';
      summaryRow.getCell('transfers_count').alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      summaryRow.getCell('total_amount').numFmt = '#,##0.00';
      summaryRow.getCell('total_amount').alignment = { horizontal: 'right', vertical: 'middle' };
      summaryRow.getCell('suspects_count').numFmt = '#,##0';
      summaryRow.getCell('suspects_count').alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  /**
   * 2-SHEET: Pul o'tkazmalari
   */
  private buildTransfersSheet(workbook: ExcelJS.Workbook, applications: Application[]): void {
    const ws = workbook.addWorksheet("Pul o'tkazmalari", {
      views: [{ state: 'frozen', ySplit: 1 }],
      // Qat'iy oq-qora qoida: tabColor yo'q
    });

    ws.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'app_num', width: 22 },
      { header: 'Arizachi F.I.SH', key: 'citizen_name', width: 28 },
      { header: 'Jabrlanuvchi Kartasi', key: 'sender_card', width: 22 },
      { header: "Xizmat Ko'rsatuvchi Bank", key: 'sender_bank', width: 24 },
      { header: "O'tkazma Summasi", key: 'amount', width: 22 },
      { header: 'Valyuta', key: 'currency', width: 10 },
      { header: "To'lov Provayderi / Ilova", key: 'provider', width: 24 },
      { header: "O'tkazma Sanasi", key: 'transfer_date', width: 18 },
      { header: 'Qabul Qiluvchi (Firibgar) Karta', key: 'receiver_card', width: 26 },
      { header: 'Firibgar Kartasi Banki', key: 'receiver_bank', width: 24 },
      { header: 'Firibgar F.I.SH / Nomi', key: 'receiver_name', width: 28 },
      { header: 'Holati / Izoh', key: 'status', width: 18 },
    ];

    this.styleHeaderRow(ws.getRow(1));

    let transferIndex = 0;
    for (const app of applications) {
      const citizenName = app.citizen
        ? [app.citizen.last_name, app.citizen.first_name, app.citizen.middle_name]
            .filter(Boolean)
            .join(' ')
        : '—';

      const transfers = this.extractAllTransfers(app);
      const appNumber = app.application_number || `AR-${app.id}`;

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
          app_num: appNumber,
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

        this.styleDataRow(row);

        // Karta raqamlarini matn formatida saqlash (@)
        row.getCell('app_num').numFmt = '@';
        row.getCell('sender_card').numFmt = '@';
        row.getCell('receiver_card').numFmt = '@';

        const amountCell = row.getCell('amount');
        amountCell.numFmt = '#,##0.00';
        amountCell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }

    // Yakuniy qatorlar: JAMI, O'RTACHA va SONI
    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      // 1. Jami Summa Qatori (Double border bilan)
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

      this.styleTotalRow(totalRow);
      totalRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      // 2. O'rtacha Summa Qatori
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
      this.styleSubTotalRow(avgRow);
      avgRow.getCell('sender_bank').alignment = { horizontal: 'right', vertical: 'middle' };
      avgRow.getCell('amount').numFmt = '#,##0.00';
      avgRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };

      // 3. Jami O'tkazmalar Soni Qatori
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
      this.styleSubTotalRow(countRow);
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
      // Qat'iy oq-qora qoida: tabColor yo'q
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

    this.styleHeaderRow(ws.getRow(1));

    let suspectIndex = 0;
    for (const app of applications) {
      const suspectItems = this.extractSuspectItems(app.suspect_tree);
      const dateStr = app.created_at ? new Date(app.created_at).toISOString().slice(0, 10) : '—';
      const crimeStr = app.crime ? app.crime.article || app.crime.title : '—';
      const appNumber = app.application_number || `AR-${app.id}`;

      for (const item of suspectItems) {
        suspectIndex++;
        const row = ws.addRow({
          idx: suspectIndex,
          app_num: appNumber,
          crime: crimeStr,
          field_name: item.label,
          field_value: item.value,
          note: item.note || '—',
          created_at: dateStr,
        });

        this.styleDataRow(row);

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

    // Gumonlanuvchilar bo'yicha JAMI qatori
    const lastDataRow = ws.rowCount;
    if (lastDataRow >= 2) {
      const totalRow = ws.addRow({
        idx: '',
        app_num: '',
        crime: '',
        field_name: 'JAMI IDENTIFIKATORLAR:',
        field_value: { formula: `COUNTA(E2:E${lastDataRow})` },
        note: 'ta rekvizit',
        created_at: '',
      });

      this.styleTotalRow(totalRow);
      totalRow.getCell('field_name').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('field_value').numFmt = '#,##0';
      totalRow.getCell('field_value').alignment = { horizontal: 'left', vertical: 'middle' };
    }
  }

  /**
   * 4-SHEET: Xulosa va Statistika (Excel Formulalari bilan)
   */
  private buildSummarySheet(
    workbook: ExcelJS.Workbook,
    applications: Application[],
    appCount: number,
    transferCount: number,
    suspectCount: number,
  ): void {
    const ws = workbook.addWorksheet('Xulosa va Statistika', {
      // Qat'iy oq-qora qoida: tabColor yo'q
    });

    ws.columns = [{ width: 5 }, { width: 42 }, { width: 24 }, { width: 14 }, { width: 30 }];

    // Asosiy Sarlavha
    ws.mergeCells('B2:E2');
    const titleCell = ws.getCell('B2');
    titleCell.value = '«ARIZALAR VA MUROJAATLAR» TIZIMI TAHLILIY HISOBOTI';
    titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: '000000' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    this.applyBorder(ws.getRow(2), 2, 5);
    ws.getRow(2).height = 32;

    // Generatsiya sanasi
    ws.mergeCells('B3:E3');
    const subTitle = ws.getCell('B3');
    subTitle.value = `Hisobot shakllantirilgan sana: ${new Date().toLocaleString('uz-UZ')}`;
    subTitle.font = { name: 'Calibri', size: 9, italic: true, color: { argb: '334155' } };
    subTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(3).height = 20;

    // Bo'lim 1: Moliyaviy va Asosiy Ko'rsatkichlar
    let curRow = 5;
    const sec1 = ws.getCell(`B${curRow}`);
    sec1.value = "1. ASOSIY UMUMIY VA MOLIYAVIY KO'RSATKICHLAR";
    sec1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: '000000' } };
    curRow++;

    // Formula manbalari qator chegaralari
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
        title: 'Jami yetkazilgan moddiy zarar miqdori',
        formula: `SUM('Pul o''tkazmalari'!F2:F${maxTransferRow})`,
        unit: "so'm (UZS)",
        format: '#,##0.00',
      },
      {
        title: "O'rtacha bitta o'tkazma zarari",
        formula: `IFERROR(AVERAGE('Pul o''tkazmalari'!F2:F${maxTransferRow}), 0)`,
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

    // Bo'lim 2: Arizalarning holatlar bo'yicha taqsimoti
    curRow += 2;
    const sec2 = ws.getCell(`B${curRow}`);
    sec2.value = "2. ARIZALARNING HOLATLAR BO'YICHA TAQSIMOTI";
    sec2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: '000000' } };
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
      r.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: '000000' } };

      const valCell = r.getCell(3);
      valCell.value = { formula: st.formula };
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

    // Bo'lim 3: Tumanlar (Hududlar) kesimidagi tahlil
    curRow += 2;
    const sec3 = ws.getCell(`B${curRow}`);
    sec3.value = "3. HUDUDLAR (TUMANLAR) BO'YICHA ARIZALAR VA ZARAR TAHLILI";
    sec3.font = { name: 'Calibri', size: 11, bold: true, color: { argb: '000000' } };
    curRow++;

    // Tumanlar jadvali sarlavhasi
    const distHeaderRow = ws.getRow(curRow);
    distHeaderRow.getCell(2).value = 'Tuman / Shahar';
    distHeaderRow.getCell(3).value = 'Arizalar soni';
    distHeaderRow.getCell(4).value = 'Birligi';
    distHeaderRow.getCell(5).value = 'Zarar miqdori';
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

    // Eksport qilinayotgan ma'lumotlardagi noyob tumanlarni olish
    const districtSet = new Set<string>();
    applications.forEach((app) => {
      const d = app.district?.name || app.citizen?.district?.name;
      if (d) districtSet.add(d);
    });

    const districtsList =
      districtSet.size > 0
        ? Array.from(districtSet)
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
            'Yakkabog’ t.',
            'G’uzor t.',
            'Dehqonobod t.',
            'Qamashi t.',
            'Muborak t.',
            'Mirishkor t.',
            'Ko’kdala t.',
          ];

    districtsList.forEach((districtName) => {
      const r = ws.getRow(curRow);
      r.getCell(2).value = districtName;
      r.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: '000000' } };

      // Tuman bo'yicha COUNTIF
      const valCell = r.getCell(3);
      valCell.value = {
        formula: `COUNTIF('Arizalar ro''yxati'!E2:E${maxAppRow}, "*${districtName.replace('*', '')}*")`,
      };
      valCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      valCell.numFmt = '#,##0';
      valCell.alignment = { horizontal: 'right', vertical: 'middle' };

      r.getCell(4).value = 'ta';
      r.getCell(4).font = { name: 'Calibri', size: 9, italic: true, color: { argb: '475569' } };
      r.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };

      // Tuman bo'yicha SUMIF (Zarar miqdori)
      const distAmountCell = r.getCell(5);
      distAmountCell.value = {
        formula: `SUMIF('Arizalar ro''yxati'!E2:E${maxAppRow}, "*${districtName.replace('*', '')}*", 'Arizalar ro''yxati'!P2:P${maxAppRow})`,
      };
      distAmountCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      distAmountCell.numFmt = '#,##0.00';
      distAmountCell.alignment = { horizontal: 'right', vertical: 'middle' };

      r.height = 22;
      this.applyBorder(r, 2, 5);
      curRow++;
    });
  }

  // =========================================================================
  // HELPER VA USLUB METODLARI (QAT'IY OQ-QORA VA AUDIT CHEGARALARI)
  // =========================================================================

  private extractAllTransfers(app: Application): TransferItem[] {
    const list: TransferItem[] = [];
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

  /**
   * Sarlavha qatori uslubi:
   * Och kulrang (#F1F5F9) fon, qalin qora (#000000) Calibri matn, pastida qalinroq chegara.
   */
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

  /**
   * Ma'lumot qatori uslubi:
   * 100% sof oq fon (#FFFFFF), hech qanday rangli zebra yo'q.
   * Toza qora (#000000) Calibri 9.5pt matn, ingichka chegara.
   */
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

  /**
   * Yakuniy JAMI qatori uslubi:
   * Qalin qora matn, tepasi ingichka qora chiziq, pastki qismi esa rasmiy buxgalteriya qo'shaloq chizig'i (double border).
   */
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

  /**
   * Oraliq orqali yakunlovchi (O'rtacha, soni) qator uslubi:
   */
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
