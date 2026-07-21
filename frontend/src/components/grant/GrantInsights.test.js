import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import GrantInsights from './GrantInsights';

vi.mock('../../lib/data/grants', () => ({
  listGrantInsightsForUser: vi.fn(),
}));

import { listGrantInsightsForUser } from '../../lib/data/grants';

const session = { userRecord: { id: 'user-1', firstname: 'Maria' } };

function renderInsights() {
  return render(
    <MemoryRouter>
      <GrantInsights session={session} />
    </MemoryRouter>
  );
}

describe('GrantInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders computed tiles and the funding-sources table', async () => {
    listGrantInsightsForUser.mockResolvedValue({
      data: [
        { id: 1, grant_name: 'Alpha Grant', status: 'approved', grant_amount: 1000, disbursed_funds: 800, funding_source: 'State Fund', submitted_at: '2023-01-01T00:00:00Z' },
        { id: 2, grant_name: 'Beta Grant', status: 'declined', grant_amount: 500, disbursed_funds: 0, funding_source: 'State Fund', submitted_at: '2023-05-01T00:00:00Z' },
        { id: 3, grant_name: 'Gamma Grant', status: 'pending', grant_amount: 2000, disbursed_funds: 0, funding_source: null, submitted_at: '2024-02-01T00:00:00Z' },
      ],
      error: null,
    });

    renderInsights();

    // Tiles: total applications = 3 (the "Applications" tile value).
    await waitFor(() => expect(screen.getByText('Grant Insights')).toBeInTheDocument());
    expect(screen.getAllByText('Applications').length).toBeGreaterThan(0);
    expect(screen.getByText('3')).toBeInTheDocument();

    // Success rate = approved / (approved + declined) = 1/2 = 50%.
    expect(screen.getByText('50%')).toBeInTheDocument();

    // Source table lists the mocked funding source and the Unspecified bucket.
    expect(screen.getAllByText('State Fund').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unspecified').length).toBeGreaterThan(0);
  });

  test('shows empty state when the grantee has no applications', async () => {
    listGrantInsightsForUser.mockResolvedValue({ data: [], error: null });

    renderInsights();

    await waitFor(() =>
      expect(screen.getByText('No grant applications yet')).toBeInTheDocument()
    );
  });
});
