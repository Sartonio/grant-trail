import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Consolidated coverage for the three grant-mutation forms (CreateGrant,
// AddExpenseModal, BudgetItemModal). Replaces the per-file *.sentry.test.js
// trio, which were near-identical and asserted brittle console strings.
//
//   - error path (describe.each): one shared assertion — the catch block reports
//     to Sentry. We no longer assert the exact console message.
//   - success path: the row payload actually handed to supabase insert is the
//     load-bearing behavior the old tests never checked.

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// One configurable Supabase mock shared by every test. `nextError` flips the
// query result to the error branch; `calls` records the insert/update payloads.
const calls = { insert: [], update: [] };
let nextError = null;
function makeBuilder() {
  const builder = {
    then: (resolve) => resolve({ data: nextError ? null : { id: 1 }, error: nextError }),
    insert: vi.fn((rows) => { calls.insert.push(rows); return builder; }),
    update: vi.fn((row) => { calls.update.push(row); return builder; }),
    select: vi.fn(() => builder),
    single: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    delete: vi.fn(() => builder),
  };
  return builder;
}
vi.mock('../../supabaseClient', () => ({ supabase: { from: vi.fn(() => makeBuilder()) } }));

import CreateGrant from './CreateGrant';
import AddExpenseModal from './AddExpenseModal';
import BudgetItemModal from './BudgetItemModal';

const selfService = { tenantConfig: { type: 'self_service' }, userRecord: { id: 'u1', tenant_id: 't1' } };

// Render + fill + submit each form with VALID input, so the only thing standing
// between the submit and the supabase call is the (mocked) network.
function submitCreateGrant() {
  const { container } = render(
    <MemoryRouter><CreateGrant session={selfService} /></MemoryRouter>,
  );
  fireEvent.change(container.querySelector('[name="grant_name"]'), { target: { value: '  Test Grant  ' } });
  fireEvent.change(container.querySelector('[name="start_spend_period"]'), { target: { value: '2026-01-01' } });
  fireEvent.change(container.querySelector('[name="end_spend_period"]'), { target: { value: '2026-12-31' } });
  fireEvent.change(container.querySelector('[name="grant_amount"]'), { target: { value: '1000' } });
  fireEvent.submit(container.querySelector('form'));
}

function submitAddExpense() {
  // require_expense_approval:false skips the receipt requirement, so a brand-new
  // expense can be saved without a file upload.
  const session = { tenantConfig: { type: 'self_service', require_expense_approval: false }, userRecord: { id: 'u1', tenant_id: 't1' } };
  const { container } = render(
    <AddExpenseModal grantId={1} session={session} onClose={vi.fn()} onSuccess={vi.fn()} />,
  );
  fireEvent.change(container.querySelector('[name="item_name"]'), { target: { value: 'Office Supplies' } });
  fireEvent.change(container.querySelector('[name="amount_spent"]'), { target: { value: '42.50' } });
  fireEvent.submit(container.querySelector('form'));
}

function submitBudgetItem() {
  render(<BudgetItemModal grantId={1} session={selfService} onClose={vi.fn()} onSuccess={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Item Name/i), { target: { value: 'Salaries' } });
  fireEvent.change(screen.getByLabelText(/Allocated Budget/i), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: /Add Budget Item/i }));
}

beforeEach(() => {
  captureException.mockClear();
  calls.insert = [];
  calls.update = [];
  nextError = null;
});

describe.each([
  ['CreateGrant', submitCreateGrant],
  ['AddExpenseModal', submitAddExpense],
  ['BudgetItemModal', submitBudgetItem],
])('%s error reporting', (_name, submit) => {
  it('reports the failure to Sentry when the supabase write errors', async () => {
    nextError = new Error('DB unavailable');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    submit();

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(nextError));
  });
});

describe('grant mutation success payloads', () => {
  it('CreateGrant inserts a pending grant_record with trimmed name and numeric amount', async () => {
    submitCreateGrant();
    await waitFor(() => expect(calls.insert.length).toBe(1));

    expect(calls.insert[0][0]).toMatchObject({
      user_id: 'u1',
      grant_name: 'Test Grant',
      start_spend_period: '2026-01-01',
      end_spend_period: '2026-12-31',
      grant_amount: 1000,
      status: 'pending',
    });
    expect(typeof calls.insert[0][0].submitted_at).toBe('string');
  });

  it('AddExpenseModal inserts a pending expense with the numeric amount', async () => {
    submitAddExpense();
    await waitFor(() => expect(calls.insert.length).toBe(1));

    expect(calls.insert[0][0]).toMatchObject({
      grant_id: 1,
      budget_item_id: null,
      item_name: 'Office Supplies',
      amount_spent: 42.5,
      status: 'pending',
    });
  });

  it('BudgetItemModal inserts a pending budget_item with the numeric allocation', async () => {
    submitBudgetItem();
    await waitFor(() => expect(calls.insert.length).toBe(1));

    expect(calls.insert[0][0]).toMatchObject({
      grant_id: 1,
      item_name: 'Salaries',
      budget_allocated: 100,
      status: 'pending',
    });
  });
});
