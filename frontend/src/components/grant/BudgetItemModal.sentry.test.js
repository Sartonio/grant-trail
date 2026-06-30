import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked Sentry module — assert captureException fires from the catch block.
const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// Supabase mock whose query builder resolves with a forced error so the
// component's catch path runs.
const dbError = new Error('DB unavailable');
const builder = { then: (resolve) => resolve({ data: null, error: dbError }) };
['select', 'insert', 'update', 'delete', 'eq'].forEach((m) => { builder[m] = vi.fn(() => builder); });
vi.mock('../../supabaseClient', () => ({ supabase: { from: vi.fn(() => builder) } }));

import BudgetItemModal from './BudgetItemModal';

describe('BudgetItemModal error reporting', () => {
  beforeEach(() => { captureException.mockClear(); });

  it('captures the error in Sentry and preserves console.error when the save fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<BudgetItemModal grantId={1} onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Item Name/i), { target: { value: 'Salaries' } });
    fireEvent.change(screen.getByLabelText(/Allocated Budget/i), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Budget Item/i }));

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(dbError));
    expect(consoleSpy).toHaveBeenCalledWith('Error saving budget item:', dbError);

    consoleSpy.mockRestore();
  });
});
