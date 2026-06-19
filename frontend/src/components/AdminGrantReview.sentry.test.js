import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// Table-aware Supabase mock: the grant loads normally so the comment form
// renders, but inserting a comment is forced to fail.
const commentError = new Error('comment insert failed');
function responseFor(table, mode) {
  if (table === 'grant_comments' && mode === 'insert') return { data: null, error: commentError };
  if (mode === 'single') {
    if (table === 'grant_record') {
      return { data: { id: 1, grant_name: 'Test Grant', status: 'pending', disbursed_funds: null, user_id: 'u1' }, error: null };
    }
    return { data: {}, error: null };
  }
  return { data: [], error: null };
}
function makeBuilder(table) {
  let mode = 'list';
  const builder = {
    then: (resolve) => resolve(responseFor(table, mode)),
    insert: vi.fn(() => { mode = 'insert'; return builder; }),
    update: vi.fn(() => { mode = 'update'; return builder; }),
    single: vi.fn(() => { mode = 'single'; return builder; }),
  };
  ['select', 'delete', 'eq', 'order'].forEach((m) => { builder[m] = vi.fn(() => builder); });
  return builder;
}
vi.mock('../supabaseClient', () => ({ supabase: { from: vi.fn((table) => makeBuilder(table)) } }));

import AdminGrantReview from './AdminGrantReview';

describe('AdminGrantReview error reporting', () => {
  beforeEach(() => { captureException.mockClear(); });

  it('captures the error in Sentry and preserves console.error when posting a comment fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Subscribed admin (premium) so the write guard (#40) allows the mutation
    // and the insert-error path under test is actually exercised.
    const session = {
      user: { id: 'u1' },
      userRecord: { id: 'u1', role: 'admin' },
      membership: { hasPremiumAccess: true },
    };

    render(
      <MemoryRouter initialEntries={['/admin/grants/1']}>
        <Routes>
          <Route path="/admin/grants/:id" element={<AdminGrantReview session={session} />} />
        </Routes>
      </MemoryRouter>,
    );

    const textarea = await screen.findByPlaceholderText(/Leave a note/i);
    fireEvent.change(textarea, { target: { value: 'A review note' } });
    fireEvent.click(screen.getByRole('button', { name: /Post Comment/i }));

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(commentError));
    expect(consoleSpy).toHaveBeenCalledWith('Comment error:', commentError);

    consoleSpy.mockRestore();
  });
});
