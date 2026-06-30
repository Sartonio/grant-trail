import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// Supabase query builder resolves with a forced error so the catch path runs.
const dbError = new Error('DB unavailable');
const builder = { then: (resolve) => resolve({ data: null, error: dbError }) };
['select', 'insert', 'update', 'delete', 'eq'].forEach((m) => { builder[m] = vi.fn(() => builder); });
vi.mock('../../supabaseClient', () => ({ supabase: { from: vi.fn(() => builder) } }));

import AddExpenseModal from './AddExpenseModal';

describe('AddExpenseModal error reporting', () => {
  beforeEach(() => { captureException.mockClear(); });

  it('captures the error in Sentry and preserves console.error when the update fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Edit mode (expenseItem present) skips the receipt requirement, so the
    // form is already valid and submitting goes straight to the failing update.
    const expenseItem = { id: 5, item_name: 'Lunch', amount_spent: 10, expense_date: '2026-01-01', status: 'pending' };
    const session = { tenantConfig: { type: 'self_service' }, userRecord: { id: 'u1', tenant_id: 't1' } };

    const { container } = render(
      <AddExpenseModal grantId={1} expenseItem={expenseItem} session={session} onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(dbError));
    expect(consoleSpy).toHaveBeenCalledWith('Error updating expense:', dbError);

    consoleSpy.mockRestore();
  });
});
