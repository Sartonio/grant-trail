// src/lib/useWriteGuard.js
//
// Mutation gate for the read-only-admin lapse policy (#40). A lapsed admin can
// view admin routes but every write must be blocked and nudged to billing.
//
// Usage in a mutation handler:
//
//   const guardWrite = useWriteGuard(session);
//   async function handleApprove() {
//     if (!guardWrite()) return;   // lapsed admin -> routed to /subscription
//     await supabase.from(...).update(...);
//   }
//
// Returns a stable function: calling it returns true when the write is allowed,
// or false (after navigating to the billing nudge) when it must be blocked.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { canMutate, BILLING_NUDGE_PATH } from './policy';

export function useWriteGuard(session) {
  const navigate = useNavigate();
  return useCallback(() => {
    if (canMutate(session)) return true;
    navigate(BILLING_NUDGE_PATH);
    return false;
  }, [session, navigate]);
}
