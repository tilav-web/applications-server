import type * as ExcelJS from 'exceljs';

/**
 * Barcha Excel eksportlari uchun yagona rasmiy monoxrom (oq-qora audit) stil va formatlash helperlari.
 */
export function styleExcelHeaderRow(row: ExcelJS.Row): void {
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

export function styleExcelDataRow(row: ExcelJS.Row, wrapKeys?: string[]): void {
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

  if (wrapKeys && wrapKeys.length > 0) {
    let maxLines = 1;
    for (const key of wrapKeys) {
      const cell = row.getCell(key);
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      const text = typeof cell.value === 'string' ? cell.value : '';
      if (text.length > 45) {
        const estimated = Math.min(5, Math.ceil(text.length / 45));
        if (estimated > maxLines) maxLines = estimated;
      }
    }
    if (maxLines > 1) {
      row.height = Math.min(84, 16 + maxLines * 14);
    }
  }
}

export function styleExcelTotalRow(row: ExcelJS.Row): void {
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

export function styleExcelSubTotalRow(row: ExcelJS.Row): void {
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

export function applyExcelAutoFilter(ws: ExcelJS.Worksheet, headerRowNum = 1): void {
  const colCount = ws.columnCount;
  if (colCount < 1) return;
  const lastColLetter = ws.getColumn(colCount).letter;
  ws.autoFilter = {
    from: `A${headerRowNum}`,
    to: `${lastColLetter}${headerRowNum}`,
  };
}

export function formatTransferDateTime(
  transferDate?: string | Date | null,
  transferTime?: string | null,
  fallbackCreatedAt?: string | Date | null,
): string {
  if (transferDate) {
    const datePart =
      typeof transferDate === 'string'
        ? transferDate.trim().slice(0, 10)
        : new Date(transferDate).toISOString().slice(0, 10);
    const timePart = transferTime ? transferTime.trim().slice(0, 5) : '';
    return timePart ? `${datePart} ${timePart}` : datePart;
  }
  if (fallbackCreatedAt) {
    return new Date(fallbackCreatedAt).toISOString().slice(0, 16).replace('T', ' ');
  }
  return '—';
}

export const TRANSFER_STATUS_LABELS: Record<string, string> = {
  KUTILMOQDA: 'Kutilmoqda',
  MUVAFFAQIYATLI: 'Muvaffaqiyatli',
  BEKOR_QILINDI: 'Bekor qilindi',
  BEKOR_QILINGAN: 'Bekor qilingan',
  MUZLATILGAN: 'Muzlatilgan',
  QAYTARILGAN: 'Qaytarilgan',
};

export const DESTINATION_TYPE_LABELS: Record<string, string> = {
  CARD: 'Plastik karta',
  BANK_ACCOUNT: 'Bank hisob raqami',
  CRYPTO: 'Kripto-hamyon / Birja',
  PLATFORM: 'Onlayn platforma',
  PHONE: 'Telefon / E-hamyon',
  CASH: 'Naqd / Bankomat',
  MERCHANT: 'Savdo nuqtasi / Merchant',
  OTHER: 'Boshqa kanal',
};

export function formatTransferStatus(status?: string | null): string {
  if (!status) return 'Tugallangan';
  return TRANSFER_STATUS_LABELS[status.toUpperCase()] || status;
}

export function formatDestinationType(destType?: string | null): string {
  if (!destType) return 'Plastik karta';
  return DESTINATION_TYPE_LABELS[destType.toUpperCase()] || destType;
}
