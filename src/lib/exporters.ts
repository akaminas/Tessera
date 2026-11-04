/**
 * Report exports. Libraries are loaded on demand so they do not weigh on the
 * initial bundle. All content comes from the caller (real database values).
 */
export type Cell = string | number | null | undefined | Date;

export function csvEscape(v: Cell): string {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  // Neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCSV(filename: string, rows: Cell[][]) {
  save(new Blob(['﻿' + toCSV(rows)], { type: 'text/csv;charset=utf-8' }), filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export interface SheetSpec {
  name: string;
  header: string[];
  rows: Cell[][];
  /** per-column number formats, e.g. '#,##0.00' */
  formats?: (string | undefined)[];
  widths?: number[];
  totals?: boolean;
}

export async function buildXLSX(sheets: SheetSpec[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tessera';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet');
    ws.addRow(s.header);
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF6EE' } };
    head.border = { bottom: { style: 'thin', color: { argb: 'FFC7C3BD' } } };
    for (const r of s.rows) ws.addRow(r.map((c) => (c === undefined ? null : c)));
    if (s.totals && s.rows.length) {
      const totalRow = ws.addRow(
        s.header.map((_, i) => {
          if (i === 0) return 'Total';
          const numeric = s.rows.every((r) => r[i] == null || typeof r[i] === 'number');
          if (!numeric || !s.formats?.[i]) return null;
          const col = ws.getColumn(i + 1).letter;
          return { formula: `SUM(${col}2:${col}${s.rows.length + 1})` };
        }),
      );
      totalRow.font = { bold: true };
      totalRow.border = { top: { style: 'thin', color: { argb: 'FFC7C3BD' } } };
    }
    s.header.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      col.width = s.widths?.[i] ?? Math.min(60, Math.max(10, h.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2)));
      if (s.formats?.[i]) col.numFmt = s.formats[i]!;
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function downloadXLSX(filename: string, sheets: SheetSpec[]) {
  const buf = await buildXLSX(sheets);
  save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export interface PdfSection {
  heading: string;
  paragraphs?: string[];
  table?: { head: string[]; body: Cell[][]; numeric?: number[] };
}

export async function downloadPDF(filename: string, title: string, subtitle: string, sections: PdfSection[]) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const ink: [number, number, number] = [42, 40, 37];
  const muted: [number, number, number] = [138, 133, 124];
  doc.setFont('times', 'normal');
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text(title, 40, 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(subtitle, 40, 72);
  let y = 96;
  for (const s of sections) {
    if (y > 740) {
      doc.addPage();
      y = 56;
    }
    doc.setFont('times', 'normal');
    doc.setFontSize(13);
    doc.setTextColor(...ink);
    doc.text(s.heading, 40, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const p of s.paragraphs ?? []) {
      const lines = doc.splitTextToSize(p, 515) as string[];
      doc.text(lines, 40, y);
      y += lines.length * 11 + 4;
    }
    if (s.table) {
      autoTable(doc, {
        startY: y,
        head: [s.table.head],
        body: s.table.body.map((r) => r.map((c) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)))),
        styles: { font: 'helvetica', fontSize: 8, textColor: ink, lineColor: [230, 224, 212], lineWidth: 0.4, cellPadding: 3 },
        headStyles: { fillColor: [250, 246, 238], textColor: ink, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        columnStyles: Object.fromEntries((s.table.numeric ?? []).map((i) => [i, { halign: 'right' }])),
        margin: { left: 40, right: 40 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
    }
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text(`Tessera · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · page ${i} of ${pages}`, 40, 820);
  }
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
