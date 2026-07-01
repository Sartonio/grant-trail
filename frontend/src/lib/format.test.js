import { describe, it, expect } from 'vitest';
import { formatDate, formatDateMed, formatCurrency, formatExcelDate, fmtBytes, timeRemaining } from './format';

describe('formatDate', () => {
  it('renders day-Mon-year with leading zero stripped from the day', () => {
    expect(formatDate('2024-05-05')).toBe('5-May-2024');
    expect(formatDate('2024-12-25')).toBe('25-Dec-2024');
  });
  it('uses only the date part of an ISO timestamp', () => {
    expect(formatDate('2024-05-05T10:30:00Z')).toBe('5-May-2024');
  });
  it('returns the em dash for empty input', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDate(null)).toBe('—');
  });
});

describe('formatDateMed', () => {
  it('renders the short-month locale style', () => {
    expect(formatDateMed('2024-05-05')).toBe('May 5, 2024');
    expect(formatDateMed('2024-05-05T10:30:00Z')).toBe('May 5, 2024');
  });
  it('returns the em dash for empty input', () => {
    expect(formatDateMed(null)).toBe('—');
  });
});

describe('formatCurrency', () => {
  it('formats USD with two fraction digits by default', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });
  it('honors a zero-fraction-digit request', () => {
    expect(formatCurrency(1234.5, 0)).toBe('$1,235');
  });
  it('returns the em dash for null', () => {
    expect(formatCurrency(null)).toBe('—');
  });
});

describe('formatExcelDate', () => {
  it('keeps the leading zero on the day (unlike formatDate)', () => {
    expect(formatExcelDate('2026-07-01')).toBe('01-Jul-2026');
    expect(formatExcelDate('2026-12-25T00:00:00Z')).toBe('25-Dec-2026');
  });
  it('returns the em dash for empty input', () => {
    expect(formatExcelDate('')).toBe('—');
  });
});

describe('fmtBytes', () => {
  it('renders KB under a megabyte and MB above', () => {
    expect(fmtBytes(2048)).toBe('2 KB');
    expect(fmtBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
  it('returns the em dash for falsy/zero', () => {
    expect(fmtBytes(0)).toBe('—');
  });
});

describe('timeRemaining', () => {
  const iso = (d) => d.toISOString().slice(0, 10);
  it('flags past dates expired and same-day as last day', () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const past = new Date(today); past.setDate(past.getDate() - 1);
    expect(timeRemaining(iso(past)).cls).toBe('expired');
    expect(timeRemaining(iso(today)).display).toBe('Last day!');
  });
  it('warns inside 30 days and months+days beyond', () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const soon = new Date(today); soon.setDate(soon.getDate() + 10);
    expect(timeRemaining(iso(soon))).toEqual({ display: '10d left', cls: 'warning' });
    const far = new Date(today); far.setDate(far.getDate() + 200);
    expect(timeRemaining(iso(far)).cls).toBe('');
  });
  it('returns the em dash for empty input', () => {
    expect(timeRemaining('')).toEqual({ display: '—', cls: '' });
  });
});
