import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// The attachment list query resolves with one row so the delete button renders.
// Storage operations are forced to fail to exercise both catch paths.
const existingAttachment = { id: 7, file_name: 'doc.pdf', file_path: 'p/doc.pdf', file_type: 'application/pdf', file_size: 1024, category: 'general', created_at: '2026-01-01' };
const listBuilder = { then: (resolve) => resolve({ data: [existingAttachment], error: null }) };
['select', 'insert', 'delete', 'eq', 'order'].forEach((m) => { listBuilder[m] = vi.fn(() => listBuilder); });

const storageBuilder = {
  upload: vi.fn(() => Promise.resolve({ error: new Error('storage rejected') })),
  remove: vi.fn(() => Promise.reject(new Error('storage rejected'))),
};
vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => listBuilder),
    storage: { from: vi.fn(() => storageBuilder) },
  },
}));

import GrantAttachments from './GrantAttachments';

const session = { userRecord: { id: 'u1', tenant_id: 't1' }, user: { id: 'u1' } };

describe('GrantAttachments error reporting', () => {
  beforeEach(() => { captureException.mockClear(); });

  it('captures the error and preserves console.error when an upload fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<GrantAttachments grantId={1} session={session} />);

    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: /Upload/i }));

    await waitFor(() => expect(captureException).toHaveBeenCalled());
    expect(consoleSpy).toHaveBeenCalledWith('Attachment upload error:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('captures the error and preserves console.error when a delete fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GrantAttachments grantId={1} session={session} />);

    // First click arms the confirm prompt, second click runs the (failing) delete.
    fireEvent.click(await screen.findByTitle('Delete attachment'));
    fireEvent.click(await screen.findByText('Yes'));

    await waitFor(() => expect(captureException).toHaveBeenCalled());
    expect(consoleSpy).toHaveBeenCalledWith('Delete error:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
