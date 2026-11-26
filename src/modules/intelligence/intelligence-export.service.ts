import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';

import {
  applyExcelAutoFilter,
  formatTransferDateTime,
  sanitizeExcelRow,
  styleExcelDataRow,
  styleExcelHeaderRow,
  styleExcelTotalRow,
} from '../../common/utils/excel-style.util';
import type { FullDossierResponse } from './intelligence.types';

@Injectable()
export class IntelligenceExportService {
  private formatMoney(val?: number | null, currency = 'UZS'): string {
    const num = Number(val || 0);
    return `${new Intl.NumberFormat('uz-UZ').format(Math.round(num))} ${currency}`;
  }

  private formatDate(dateStr?: string | null): string {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('uz-UZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  private asStr(v: unknown, fallback = ''): string {
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
    return fallback;
  }

  private extractDossierTitle(dossier: FullDossierResponse): {
    heading: string;
    subtitle: string;
    fileSlug: string;
  } {
    if (dossier.entityType === 'citizen' && dossier.citizen) {
      const c = dossier.citizen;
      const name = this.asStr(c.full_name, 'Fuqaro');
      const firstWord = name.split(/\s+/)[0] || 'Profil';
      return {
        heading: `FUQARO BOʻYICHA 360° TAHLILIY MAʼLUMOTNOMA: ${name}`,
        subtitle: `Pasport: ${this.asStr(c.passport, '—')} | JSHSHIR: ${this.asStr(c.pinfl, '—')} | Tel: ${this.asStr(c.phone_number, '—')}`,
        fileSlug: `Fuqaro_Dosye_${firstWord}`,
      };
    }
    if (dossier.entityType === 'card' && dossier.card) {
      const crd = dossier.card;
      const num = this.asStr(crd.card_number) || this.asStr(crd.masked_number, 'Karta');
      return {
        heading: `PLASTIK KARTA BOʻYICHA 360° TAHLILIY MAʼLUMOTNOMA: ${num}`,
        subtitle: `Bank: ${this.asStr(crd.inferred_bank_name, '—')} | Kartadagi F.I.O: ${this.asStr(crd.full_name, '—')}`,
        fileSlug: `Karta_Dosye_${num.slice(-4)}`,
      };
    }
    if (dossier.entityType === 'phone' && dossier.phone) {
      const ph = dossier.phone;
      const phNum = this.asStr(ph.formatted_number) || this.asStr(ph.phone_number, 'Raqam');
      return {
        heading: `TELEFON RAQAM BOʻYICHA TAHLILIY MAʼLUMOTNOMA: ${phNum}`,
        subtitle: `Aloqa operatori: ${this.asStr(ph.operator, '—')}`,
        fileSlug: `Telefon_Dosye_${this.asStr(ph.phone_number, 'Raqam')}`,
      };
    }
    const idObj = dossier.identifier || {};
    const rawVal = this.asStr(idObj.raw_value);
    const typeLbl = this.asStr(idObj.type_label) || this.asStr(idObj.type, 'Belgi');
    return {
      heading: `RAQAMLI IDENTIFIKATOR BOʻYICHA MAʼLUMOTNOMA: ${rawVal}`,
      subtitle: `Turi: ${typeLbl}`,
      fileSlug: `Identifikator_Dosye`,
    };
  }

  async exportExcel(dossier: FullDossierResponse, res: Response): Promise<void> {
    const meta = this.extractDossierTitle(dossier);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Arizalar bazasi';
    wb.created = new Date();

    const roleLabelMap: Record<string, string> = {
      VICTIM: 'Jabrlanuvchi',
      SUSPECT: 'Gumonlanuvchi',
      DROPPER: 'Dropper / Karta egasi',
      TRANSIT: 'Tranzit',
      WITNESS: 'Guvoh',
      MIXED: 'Aralash rol',
    };

    // 1-Varaq: Umumiy Statistika va Rekvizitlar
    const wsSummary = wb.addWorksheet('Umumiy Dosye', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    wsSummary.columns = [
      { header: "Ko'rsatkich", key: 'k', width: 42 },
      { header: 'Qiymat', key: 'v', width: 58 },
    ];
    styleExcelHeaderRow(wsSummary.getRow(1));

    const summaryEntries: Array<{ k: string; v: string | number; isMoney?: boolean }> = [
      { k: "Ob'ekt nomi", v: meta.heading },
      { k: 'Rekvizitlar', v: meta.subtitle },
      { k: 'Xavf bahosi', v: `${dossier.stats.riskScore}% — ${dossier.stats.riskLabel}` },
      { k: "Jami bog'langan arizalar", v: `${dossier.stats.totalApplications} ta` },
      {
        k: 'Jabrlanuvchi / Gumonlanuvchi-Dropper sifatida',
        v: `${dossier.stats.victimAppsCount} ta / ${dossier.stats.suspectOrDropperAppsCount} ta`,
      },
      {
        k: "Arizalar bo'yicha umumiy zarar (UZS)",
        v: Number(dossier.stats.totalLossInLinkedApps) || 0,
        isMoney: true,
      },
      {
        k: 'Kartalarga jami kirim (UZS)',
        v: Number(dossier.stats.totalIncomingAmount) || 0,
        isMoney: true,
      },
      {
        k: 'Kartalardan jami chiqim (UZS)',
        v: Number(dossier.stats.totalOutgoingAmount) || 0,
        isMoney: true,
      },
      {
        k: 'Birinchi va oxirgi faollik sanasi',
        v: `${this.formatDate(dossier.stats.firstSeenDate)} — ${this.formatDate(dossier.stats.lastSeenDate)}`,
      },
    ];

    for (const item of summaryEntries) {
      const row = wsSummary.addRow(sanitizeExcelRow({ k: item.k, v: item.v }));
      styleExcelDataRow(row, ['v']);
      row.getCell('k').font = { name: 'Calibri', size: 10, bold: true, color: { argb: '000000' } };
      if (item.isMoney) {
        row.getCell('v').numFmt = '#,##0.00';
        row.getCell('v').alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }

    // 2-Varaq: Bog'langan Arizalar
    const wsApps = wb.addWorksheet("Bog'langan Arizalar", {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    wsApps.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'num', width: 20 },
      { header: 'Sana', key: 'date', width: 13 },
      { header: 'Holati', key: 'status', width: 22 },
      { header: 'Roli', key: 'role', width: 20 },
      { header: 'Tuman', key: 'dist', width: 18 },
      { header: 'Jinoyat Moddasi', key: 'crime', width: 22 },
      { header: 'Jabrlanuvchi', key: 'victim', width: 28 },
      { header: 'Zarar Summasi', key: 'amount', width: 20 },
      { header: 'Valyuta', key: 'currency', width: 10 },
      { header: "Bog'lanish Asosi", key: 'reason', width: 42 },
    ];
    styleExcelHeaderRow(wsApps.getRow(1));
    applyExcelAutoFilter(wsApps, 1);

    dossier.directApplications.forEach((app, i) => {
      const row = wsApps.addRow(
        sanitizeExcelRow({
          idx: i + 1,
          num: app.application_number || '—',
          date: this.formatDate(app.date),
          status: app.status_label || app.status || '—',
          role: roleLabelMap[app.role_in_app] || app.role_in_app,
          dist: app.district_name || '—',
          crime: app.crime_article || '—',
          victim: app.victim_name || '—',
          amount: Number(app.transfer_amount) || 0,
          currency: app.currency || 'UZS',
          reason: app.match_reasons.join('; ') || '—',
        }),
      );
      styleExcelDataRow(row, ['reason']);
      row.getCell('num').numFmt = '@';
      row.getCell('amount').numFmt = '#,##0.00';
      row.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
    });

    if (wsApps.rowCount >= 2) {
      const lastAppRow = wsApps.rowCount;
      const totalRow = wsApps.addRow({
        victim: 'JAMI (UZS):',
        amount: { formula: `SUMIF(J2:J${lastAppRow}, "UZS", I2:I${lastAppRow})` },
        currency: 'UZS',
      });
      styleExcelTotalRow(totalRow);
      totalRow.getCell('victim').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
    }

    // 3-Varaq: O'tkazmalar oqimi
    const wsTransfers = wb.addWorksheet('Pul Oqimlari', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    wsTransfers.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: "Yo'nalish", key: 'dir', width: 14 },
      { header: 'Summa', key: 'amount', width: 20 },
      { header: 'Valyuta', key: 'currency', width: 10 },
      { header: "Jo'natuvchi Karta", key: 'sender', width: 22 },
      { header: "Jo'natuvchi F.I.SH", key: 'sender_owner', width: 26 },
      { header: 'Qabul Qiluvchi Karta', key: 'receiver', width: 22 },
      { header: 'Qabul Qiluvchi F.I.SH', key: 'receiver_owner', width: 26 },
      { header: "To'lov Tizimi", key: 'prov', width: 18 },
      { header: 'Sana va Vaqt', key: 'dt', width: 18 },
      { header: 'Ariza №', key: 'app', width: 18 },
    ];
    styleExcelHeaderRow(wsTransfers.getRow(1));
    applyExcelAutoFilter(wsTransfers, 1);

    dossier.transfers.forEach((tr, i) => {
      const row = wsTransfers.addRow(
        sanitizeExcelRow({
          idx: i + 1,
          dir:
            tr.direction === 'INCOMING'
              ? 'Kirim (+)'
              : tr.direction === 'OUTGOING'
                ? 'Chiqim (-)'
                : 'Ichki',
          amount: Number(tr.amount) || 0,
          currency: tr.currency || 'UZS',
          sender: tr.sender_card_number || '—',
          sender_owner: tr.sender_owner_name || '—',
          receiver: tr.receiver_card_number || '—',
          receiver_owner: tr.receiver_owner_name || '—',
          prov: tr.payment_provider || '—',
          dt: formatTransferDateTime(tr.transfer_date, tr.transfer_time),
          app: tr.application_number || '—',
        }),
      );
      styleExcelDataRow(row);
      row.getCell('sender').numFmt = '@';
      row.getCell('receiver').numFmt = '@';
      row.getCell('app').numFmt = '@';
      row.getCell('amount').numFmt = '#,##0.00';
      row.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
    });

    if (wsTransfers.rowCount >= 2) {
      const lastTrRow = wsTransfers.rowCount;
      const totalRow = wsTransfers.addRow({
        dir: 'JAMI (UZS):',
        amount: { formula: `SUMIF(D2:D${lastTrRow}, "UZS", C2:C${lastTrRow})` },
        currency: 'UZS',
      });
      styleExcelTotalRow(totalRow);
      totalRow.getCell('dir').alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right', vertical: 'middle' };
    }

    // 4-Varaq: Rekvizitlar va Bog'langan Izlar (Kartalar, Telefonlar, Identifikatorlar, Kesishuvlar)
    const wsAssets = wb.addWorksheet("Rekvizit va Bog'liqliklar", {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    wsAssets.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Kategoriya', key: 'category', width: 24 },
      { header: 'Turi', key: 'type', width: 20 },
      { header: 'Qiymat / Raqam', key: 'value', width: 32 },
      { header: "Qo'shimcha ma'lumot", key: 'extra', width: 38 },
    ];
    styleExcelHeaderRow(wsAssets.getRow(1));
    applyExcelAutoFilter(wsAssets, 1);

    let assetIdx = 0;
    for (const c of dossier.ownedCards || []) {
      assetIdx++;
      const cardNum = this.asStr(c.card_number) || this.asStr(c.masked_number, '—');
      const bankObj = c.bank as Record<string, unknown> | undefined;
      const bankName = this.asStr(bankObj?.name) || this.asStr(c.inferred_bank_name);
      const row = wsAssets.addRow(
        sanitizeExcelRow({
          idx: assetIdx,
          category: 'Biriktirilgan karta',
          type: bankName || 'Plastik karta',
          value: cardNum,
          extra: this.asStr(c.full_name, '—'),
        }),
      );
      styleExcelDataRow(row);
      row.getCell('value').numFmt = '@';
    }
    for (const p of dossier.ownedPhones || []) {
      assetIdx++;
      const row = wsAssets.addRow(
        sanitizeExcelRow({
          idx: assetIdx,
          category: 'Biriktirilgan telefon',
          type: this.asStr(p.operator, 'Mobil raqam'),
          value: this.asStr(p.formatted_number) || this.asStr(p.phone_number, '—'),
          extra: this.asStr(p.label, '—'),
        }),
      );
      styleExcelDataRow(row);
      row.getCell('value').numFmt = '@';
    }
    for (const ident of dossier.ownedIdentifiers || []) {
      assetIdx++;
      const row = wsAssets.addRow(
        sanitizeExcelRow({
          idx: assetIdx,
          category: 'Raqamli identifikator',
          type: this.asStr(ident.type_label) || this.asStr(ident.type, 'Belgi'),
          value: this.asStr(ident.raw_value) || this.asStr(ident.normalized_value, '—'),
          extra: this.asStr(ident.notes, '—'),
        }),
      );
      styleExcelDataRow(row);
      row.getCell('value').numFmt = '@';
    }
    for (const clue of dossier.coOccurringClues || []) {
      assetIdx++;
      const row = wsAssets.addRow(
        sanitizeExcelRow({
          idx: assetIdx,
          category: 'Kesishgan bog‘liqlik',
          type: clue.type_label || clue.entity_type,
          value: clue.value || '—',
          extra: [
            clue.owner_name ? `Egasi: ${clue.owner_name}` : '',
            `${clue.shared_apps_count} ta umumiy ariza`,
            clue.role ? `Rol: ${roleLabelMap[clue.role] || clue.role}` : '',
          ]
            .filter(Boolean)
            .join(' | '),
        }),
      );
      styleExcelDataRow(row, ['extra']);
      row.getCell('value').numFmt = '@';
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${meta.fileSlug}_${dateStr}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    await wb.xlsx.write(res);
    res.end();
  }

  async exportDocx(dossier: FullDossierResponse, res: Response): Promise<void> {
    const meta = this.extractDossierTitle(dossier);

    const borderSpec = {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    };

    const makeCell = (text: string, bold = false) =>
      new TableCell({
        borders: borderSpec,
        children: [
          new Paragraph({
            children: [new TextRun({ text, bold, size: 20, font: 'Times New Roman' })],
          }),
        ],
      });

    const appRows: TableRow[] = [
      new TableRow({
        children: [
          makeCell('№', true),
          makeCell('Ariza raqami', true),
          makeCell('Sana', true),
          makeCell('Rol', true),
          makeCell('Tuman', true),
          makeCell('Zarar summasi', true),
          makeCell('Bogʻlanish asosi', true),
        ],
      }),
      ...dossier.directApplications.map(
        (a, idx) =>
          new TableRow({
            children: [
              makeCell(String(idx + 1)),
              makeCell(a.application_number),
              makeCell(this.formatDate(a.date)),
              makeCell(a.role_in_app),
              makeCell(a.district_name || '—'),
              makeCell(this.formatMoney(a.transfer_amount, a.currency)),
              makeCell(a.match_reasons.join(', ')),
            ],
          }),
      ),
    ];

    const transferRows: TableRow[] = [
      new TableRow({
        children: [
          makeCell('№', true),
          makeCell('Yoʻnalish', true),
          makeCell('Summa', true),
          makeCell('Joʻnatuvchi', true),
          makeCell('Qabul qiluvchi', true),
          makeCell('Provayder / Sana', true),
        ],
      }),
      ...dossier.transfers.slice(0, 50).map(
        (tr, idx) =>
          new TableRow({
            children: [
              makeCell(String(idx + 1)),
              makeCell(tr.direction === 'INCOMING' ? 'Kirim' : 'Chiqim'),
              makeCell(this.formatMoney(tr.amount, tr.currency)),
              makeCell(tr.sender_card_number || '—'),
              makeCell(tr.receiver_card_number || '—'),
              makeCell(`${tr.payment_provider || '—'} (${this.formatDate(tr.transfer_date)})`),
            ],
          }),
      ),
    ];

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              heading: HeadingLevel.HEADING_2,
              children: [
                new TextRun({
                  text: meta.heading,
                  bold: true,
                  size: 28,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 240 },
              children: [
                new TextRun({
                  text: meta.subtitle,
                  size: 22,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: `1. TAHLILIY KOʻRSATKICHLAR VA XAVF DARAJASI: `,
                  bold: true,
                  size: 24,
                  font: 'Times New Roman',
                }),
                new TextRun({
                  text: `${dossier.stats.riskScore}% (${dossier.stats.riskLabel})`,
                  bold: true,
                  size: 24,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `• Jami bogʻlangan arizalar: ${dossier.stats.totalApplications} ta (Jabrlanuvchi: ${dossier.stats.victimAppsCount}, Gumonlanuvchi/Dropper: ${dossier.stats.suspectOrDropperAppsCount})`,
                  size: 22,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `• Arizalardagi jami moliyaviy zarar: ${this.formatMoney(dossier.stats.totalLossInLinkedApps)}`,
                  size: 22,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 240 },
              children: [
                new TextRun({
                  text: `• Kartalar oqimi: Kirim = ${this.formatMoney(dossier.stats.totalIncomingAmount)} | Chiqim = ${this.formatMoney(dossier.stats.totalOutgoingAmount)} (${dossier.stats.transactionsCount} ta tranzaksiya)`,
                  size: 22,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Paragraph({
              spacing: { before: 160, after: 120 },
              children: [
                new TextRun({
                  text: '2. BOGʻLANGAN ARIZALAR ROʻYXATI',
                  bold: true,
                  size: 24,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: appRows,
            }),
            new Paragraph({
              spacing: { before: 240, after: 120 },
              children: [
                new TextRun({
                  text: '3. PUL OʻTKAZMALARI HARAKATI',
                  bold: true,
                  size: 24,
                  font: 'Times New Roman',
                }),
              ],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: transferRows,
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${meta.fileSlug}_${dateStr}.docx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  }
}
