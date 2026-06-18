import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// Supabase query builder resolves with a forced error so the catch path runs.
const dbError = new Error('DB unavailable');
const builder = { then: (resolve) => resolve({ data: null, error: dbError }) };
['select', 'insert', 'update', 'delete', 'eq'].forEach((m) => { builder[m] = vi.fn(() => builder); });
vi.mock('../supabaseClient', () => ({ supabase: { from: vi.fn(() => builder) } }));

import CreateGrant from './CreateGrant';

describe('CreateGrant error reporting', () => {
  beforeEach(() => { captureException.mockClear(); });

  it('captures the error in Sentry and preserves console.error when the insert fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const session = { userRecord: { id: 'u1' }, tenantConfig: { type: 'self_service' } };
    const { container } = render(
      <MemoryRouter>
        <CreateGrant session={session} />
      </MemoryRouter>,
    );

    fireEvent.change(container.querySelector('[name="grant_name"]'), { target: { value: 'Test Grant' } });
    fireEvent.change(container.querySelector('[name="start_spend_period"]'), { target: { value: '2026-01-01' } });
    fireEvent.change(container.querySelector('[name="end_spend_period"]'), { target: { value: '2026-12-31' } });
    fireEvent.change(container.querySelector('[name="grant_amount"]'), { target: { value: '1000' } });
    fireEvent.submit(container.querySelector('form'));

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(dbError));
    expect(consoleSpy).toHaveBeenCalledWith('Error saving grant:', dbError);

    consoleSpy.mockRestore();
  });
});
