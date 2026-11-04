import { describe, expect, it } from 'vitest';
import { csvEscape, toCSV, buildXLSX } from './exporters';

describe('CSV', () => {
  it('quotes separators and neutralises formulas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('-12.5')).toBe('-12.5');
    expect(csvEscape(null)).toBe('');
    expect(toCSV([['h1', 'h2'], [1, 'x']])).toBe('h1,h2\r\n1,x');
  });
});

describe('XLSX', () => {
  it('writes sheets with totals that ExcelJS can read back', async () => {
    const buf = await buildXLSX([{ name: 'Budget', header: ['Partner', 'Amount'], rows: [['A', 10.5], ['B', 2]], formats: [undefined, '#,##0.00'], totals: true }]);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Budget')!;
    expect(ws.getCell('A2').value).toBe('A');
    expect(ws.getCell('B3').value).toBe(2);
    expect((ws.getCell('B4').value as { formula: string }).formula).toBe('SUM(B2:B3)');
  });
});
