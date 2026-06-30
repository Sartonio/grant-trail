import { describe, it, expect } from 'vitest';
import { formatDate, formatDateMed, formatCurrency } from './format';

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
