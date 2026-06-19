import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { useWriteGuard } from './useWriteGuard';
import { ROLES } from './policy';

// Render a probe component that exposes the guard's return value.
function probe(session) {
  let result;
  function Probe() {
    const guardWrite = useWriteGuard(session);
    result = () => guardWrite();
    return null;
  }
  render(<Probe />);
  return result;
}

const adminLapsed = { userRecord: { role: ROLES.ADMIN }, membership: { hasPremiumAccess: false, isExempt: false } };
const adminPaid = { userRecord: { role: ROLES.ADMIN }, membership: { hasPremiumAccess: true } };
const granteeUnpaid = { userRecord: { role: ROLES.GRANTEE }, membership: { hasBasicAccess: false } };

describe('useWriteGuard — read-only-admin mutation gate (#40)', () => {
  beforeEach(() => navigate.mockClear());

  it('blocks a lapsed admin write and routes to the billing nudge', () => {
    const guardWrite = probe(adminLapsed);
    let allowed;
    act(() => { allowed = guardWrite(); });
    expect(allowed).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/subscription');
  });

  it('allows a paid admin write without navigating', () => {
    const guardWrite = probe(adminPaid);
    let allowed;
    act(() => { allowed = guardWrite(); });
    expect(allowed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not block non-admins (route guards handle their access)', () => {
    const guardWrite = probe(granteeUnpaid);
    let allowed;
    act(() => { allowed = guardWrite(); });
    expect(allowed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});
