import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatusBadge from './StatusBadge';

describe('StatusBadge Component', () => {
  test('renders nothing when no status is provided', () => {
    const { container } = render(<StatusBadge status="" />);
    expect(container.firstChild).toBeNull();
  });

  test('renders approved badge correctly', () => {
    render(<StatusBadge status="approved" />);
    const badge = screen.getByText('Approved');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('status-badge', 'status-approved');
  });

  test('renders pending badge correctly', () => {
    render(<StatusBadge status="pending" />);
    const badge = screen.getByText('Pending');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('status-badge', 'status-pending');
  });

  test('renders needs_changes label correctly', () => {
    render(<StatusBadge status="needs_changes" />);
    const badge = screen.getByText('Needs Changes');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('status-badge', 'status-needs_changes');
  });
});
