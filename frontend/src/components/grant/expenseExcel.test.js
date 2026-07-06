import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportExpensesExcel } from "./expenseExcel";

const baseArgs = {
  grants: [{ id: 1, grant_name: 'Grant A', grant_amount: 1000 }],
  budgetItems: [{ id: 10, item_name: 'Line 1', budget_allocated: 500 }],
  dateFrom: '',
  dateTo: '',
};

function expense(overrides = {}) {
  return {
    id: 100,
    grant_id: 1,
    budget_item_id: 10,
    amount_spent: 250,
    expense_date: '2026-07-01',
    item_name: 'Widgets',
    ...overrides,
  };
}

describe('exportExpensesExcel', () => {
  let clickSpy;

  beforeEach(() => {
    clickSpy = vi.fn();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return { href: '', download: '', click: clickSpy };
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an error and does not download when there are no expenses', async () => {
    const result = await exportExpensesExcel({ ...baseArgs, sortedExpenses: [] });
    expect(result).toEqual({ error: 'No expenses found for export.' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('returns an error when the date range is inverted', async () => {
    const result = await exportExpensesExcel({
      ...baseArgs,
      sortedExpenses: [expense()],
      dateFrom: '2026-07-31',
      dateTo: '2026-07-01',
    });
    expect(result).toEqual({ error: 'Start date must be on or before end date.' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('returns an error when no expenses fall inside the selected range', async () => {
    const result = await exportExpensesExcel({
      ...baseArgs,
      sortedExpenses: [expense({ expense_date: '2026-01-01' })],
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    expect(result).toEqual({ error: 'No expenses found in the selected date range.' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('writes a workbook and triggers a download on success', async () => {
    const result = await exportExpensesExcel({ ...baseArgs, sortedExpenses: [expense()] });
    expect(result).toBeNull();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
