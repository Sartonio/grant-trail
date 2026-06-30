import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase client. Each from(table) returns a chainable builder whose
// terminal .select() resolves to a preset result, and which is itself awaitable
// (for the cascade's `await ...update().eq()` with no .select()).
const calls = vi.hoisted(() => ({ tables: [], results: {} }));
const fromMock = vi.hoisted(() => vi.fn());

vi.mock('../../supabaseClient', () => ({ supabase: { from: fromMock } }));

import { setBudgetItemStatus } from './budgetItems';

beforeEach(() => {
  calls.tables = [];
  calls.results = { budget_items: { data: [{ id: 1 }], error: null } };
  fromMock.mockImplementation((table) => {
    calls.tables.push(table);
    const builder = {
      update: () => builder,
      eq: () => builder,
      select: () => Promise.resolve(calls.results[table] ?? { data: [], error: null }),
      then: (resolve) => resolve({ error: null }),
    };
    return builder;
  });
});

describe('setBudgetItemStatus', () => {
  it('rejecting cascades a pending-reset to the expenses table', async () => {
    await setBudgetItemStatus(1, 'rejected');
    expect(calls.tables).toEqual(['budget_items', 'expenses']);
  });

  it('approving does NOT touch expenses', async () => {
    await setBudgetItemStatus(1, 'approved');
    expect(calls.tables).toEqual(['budget_items']);
  });

  it('throws the RLS message when no rows are updated', async () => {
    calls.results.budget_items = { data: [], error: null };
    await expect(setBudgetItemStatus(1, 'approved')).rejects.toThrow(
      /check RLS policies for budget_items/
    );
  });
});
