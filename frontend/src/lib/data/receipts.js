// Data-access for the receipts table (modularity.md, Phase 3).
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').ReceiptInsert} ReceiptInsert */

// Used to build an expense_id → first receipt file lookup map on the grant
// breakdown and admin review pages.
/** @param {number} grantId */
export const listReceiptsByGrant = (grantId) =>
  supabase.from('receipts').select('expense_id, receipt_files').eq('grant_id', grantId);

/** @param {number} expenseId */
export const deleteReceiptByExpense = (expenseId) =>
  supabase.from('receipts').delete().eq('expense_id', expenseId);

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<ReceiptInsert, 'tenant_id'>} receipt */
export const insertReceipt = (receipt) => supabase.from('receipts').insert(receipt);
