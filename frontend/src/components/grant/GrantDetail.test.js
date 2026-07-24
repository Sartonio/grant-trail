import React from 'react';
import { MemoryRouter } from 'react-router';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Self-service decision recording: a grantee whose application is still Pending
// records the funder's decision from the grant detail page. "Mark Approved"
// confirms, then writes { status: 'approved' } through the owner-scoped update.

const updateOwnGrant = vi.fn(() => Promise.resolve({ error: null }));
const getGrant = vi.fn();

vi.mock('../../lib/data/grants', () => ({
  getGrant: (...a) => getGrant(...a),
  updateOwnGrant: (...a) => updateOwnGrant(...a),
}));

vi.mock('../../lib/data/grantReview', () => ({
  listGrantStatusHistory: () => Promise.resolve({ data: [] }),
  listGrantComments: () => Promise.resolve({ data: [] }),
}));

// GrantAttachments hits storage/auth — stub it out for this render.
vi.mock('./GrantAttachments', () => ({ default: () => <div data-testid="attachments" /> }));

// useParams -> the grant id under test.
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ id: '7' }) };
});

import GrantDetail from './GrantDetail';

const selfService = { tenantConfig: { type: 'self_service' }, userRecord: { id: 'u1', tenant_id: 't1' } };

function renderDetail(status = 'pending') {
  getGrant.mockResolvedValue({
    data: { id: 7, grant_name: 'Pending App', grant_amount: 1000, status },
    error: null,
  });
  return render(<MemoryRouter><GrantDetail session={selfService} /></MemoryRouter>);
}

beforeEach(() => {
  updateOwnGrant.mockClear();
  updateOwnGrant.mockResolvedValue({ error: null });
});

describe('GrantDetail — self-service decision recording', () => {
  it('Mark Approved confirms then writes { status: "approved" } scoped to the owner', async () => {
    const { container } = renderDetail('pending');

    const markBtn = await screen.findByRole('button', { name: /Mark Approved/i });
    fireEvent.click(markBtn);

    // Confirm dialog -> click its destructive confirm action (.btn-danger).
    const confirmBtn = await waitFor(() => {
      const btn = container.querySelector('.modal-footer .btn-danger');
      if (!btn) throw new Error('confirm dialog not open');
      return btn;
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(updateOwnGrant).toHaveBeenCalledWith(7, 'u1', { status: 'approved' }));
  });

  it('hides the decision control once the grant is no longer pending', async () => {
    renderDetail('approved');

    await screen.findByRole('heading', { name: 'Pending App' });
    expect(screen.queryByRole('button', { name: /Mark Approved/i })).toBeNull();
  });
});
