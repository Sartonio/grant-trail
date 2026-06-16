import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import ErrorFallback from './ErrorFallback';

describe('ErrorFallback Component', () => {
  it('renders standard error message', () => {
    const error = new Error('Test error message');
    render(<ErrorFallback error={error} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/unexpected error occurred/)).toBeInTheDocument();
    expect(screen.queryByText('Diagnostic Information')).not.toBeInTheDocument();
  });

  it('toggles technical details display', () => {
    const error = new Error('Database connection failed');
    render(<ErrorFallback error={error} />);

    const detailsBtn = screen.getByText(/Show details/);
    expect(detailsBtn).toBeInTheDocument();

    // Click to show details
    fireEvent.click(detailsBtn);
    expect(screen.getByText('Diagnostic Information')).toBeInTheDocument();
    expect(screen.getAllByText(/Database connection failed/).length).toBeGreaterThanOrEqual(1);

    // Click to hide details
    fireEvent.click(screen.getByText(/Hide details/));
    expect(screen.queryByText('Diagnostic Information')).not.toBeInTheDocument();
  });

  it('calls resetError or window.location.reload when reload button is clicked', () => {
    const resetMock = vi.fn();
    const error = new Error('App crash');
    render(<ErrorFallback error={error} resetError={resetMock} />);

    const reloadBtn = screen.getByRole('button', { name: /Reload Application/ });
    fireEvent.click(reloadBtn);

    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});
