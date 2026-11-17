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
      const name =
        [this.asStr(c.last_name), this.asStr(c.first_name), this.asStr(c.middle_name)]
          .filter(Boolean)
          .join(' ') || 'Fuqaro';
      return {
        heading: `FUQARO BOʻYICHA 360° TAHLILIY MAʼLUMOTNOMA: ${name}`,
        subtitle: `Pasport: ${this.asStr(c.passport, '—')} | JSHSHIR: ${this.asStr(c.pinfl, '—')} | Tel: ${this.asStr(c.phone_number, '—')}`,
        fileSlug: `Fuqaro_Dosye_${this.asStr(c.last_name, 'Profil')}`,
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

    // 1-Varaq: Umumiy Statistika va Rekvizitlar
    const wsSummary = wb.addWorksheet('Umumiy Dosye');
    wsSummary.columns = [
      { header: 'Koʻrsatkich', key: 'k', width: 38 },
      { header: 'Qiymat', key: 'v', width: 55 },
    ];

    wsSummary.addRow({ k: 'Obʼekt nomi', v: meta.heading });
    wsSummary.addRow({ k: 'Rekvizitlar', v: meta.subtitle });
    wsSummary.addRow({
      k: 'Xavf bahosi',
      v: `${dossier.stats.riskScore}% — ${dossier.stats.riskLabel}`,
    });
    wsSummary.addRow({ k: 'Jami bogʻlangan arizalar', v: `${dossier.stats.totalApplications} ta` });
    wsSummary.addRow({
      k: 'Jabrlanuvchi sifatida / Gumonlanuvchi-Dropper sifatida',
      v: `${dossier.stats.victimAppsCount} ta / ${dossier.stats.suspectOrDropperAppsCount} ta`,
    });
    wsSummary.addRow({
      k: 'Arizalar boʻyicha umumiy zarar',
      v: this.formatMoney(dossier.stats.totalLossInLinkedApps),
    });
    wsSummary.addRow({
      k: 'Kartalarga jami kirim (Total In)',
      v: this.formatMoney(dossier.stats.totalIncomingAmount),
    });
    wsSummary.addRow({
      k: 'Kartalardan jami chiqim (Total Out)',
      v: this.formatMoney(dossier.stats.totalOutgoingAmount),
    });
    wsSummary.addRow({
      k: 'Birinchi va oxirgi faollik sanasi',
      v: `${this.formatDate(dossier.stats.firstSeenDate)} — ${this.formatDate(dossier.stats.lastSeenDate)}`,
    });

    wsSummary.getRow(1).font = { bold: true };

    // 2-Varaq: Bog'langan Arizalar
    const wsApps = wb.addWorksheet('Bogʻlangan Arizalar');
    wsApps.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Ariza Raqami', key: 'num', width: 18 },
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Roli', key: 'role', width: 18 },
      { header: 'Tuman', key: 'dist', width: 22 },
      { header: 'Jabrlanuvchi', key: 'victim', width: 28 },
      { header: 'Zarar Summasi', key: 'amount', width: 20 },
      { header: 'Bogʻlanish Asosi', key: 'reason', width: 42 },
    ];
    wsApps.getRow(1).font = { bold: true };

    dossier.directApplications.forEach((app, i) => {
      wsApps.addRow({
        idx: i + 1,
        num: app.application_number,
        date: this.formatDate(app.date),
        role: app.role_in_app,
        dist: app.district_name || '—',
        victim: app.victim_name || '—',
        amount: this.formatMoney(app.transfer_amount, app.currency),
        reason: app.match_reasons.join('; '),
      });
    });

    // 3-Varaq: O'tkazmalar oqimi
    const wsTransfers = wb.addWorksheet('Pul Oqimlari');
    wsTransfers.columns = [
      { header: '№', key: 'idx', width: 6 },
      { header: 'Yoʻnalish', key: 'dir', width: 14 },
      { header: 'Summa', key: 'amount', width: 20 },
      { header: 'Joʻnatuvchi Karta', key: 'sender', width: 24 },
      { header: 'Qabul Qiluvchi Karta', key: 'receiver', width: 24 },
      { header: 'Toʻlov Tizimi', key: 'prov', width: 18 },
      { header: 'Sana va Vaqt', key: 'dt', width: 20 },
      { header: 'Ariza №', key: 'app', width: 16 },
    ];
    wsTransfers.getRow(1).font = { bold: true };

    dossier.transfers.forEach((tr, i) => {
      wsTransfers.addRow({
        idx: i + 1,
        dir:
          tr.direction === 'INCOMING'
            ? 'Kirim (+)'
            : tr.direction === 'OUTGOING'
              ? 'Chiqim (-)'
              : 'Ichki',
        amount: this.formatMoney(tr.amount, tr.currency),
        sender: tr.sender_card_number || '—',
        receiver: tr.receiver_card_number || '—',
        prov: tr.payment_provider || '—',
        dt: `${this.formatDate(tr.transfer_date)} ${tr.transfer_time || ''}`.trim(),
        app: tr.application_number || '—',
      });
    });

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
