// Data-access for the expenses table (modularity.md, Phase 2).
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').ExpenseRow} ExpenseRow */
/** @typedef {import('../types').ExpenseInsert} ExpenseInsert */
/** @typedef {import('../types').ExpenseUpdate} ExpenseUpdate */

/** @param {number} grantId */
export const listExpenses = (grantId) =>
  supabase.from('expenses').select('*').eq('grant_id', grantId);

/** @param {number[]} grantIds */
export const listExpensesForGrants = (grantIds) =>
  supabase.from('expenses').select('*').in('grant_id', grantIds);

// Narrow projection used to build a pending-count map on grant list pages.
/** @param {number[]} grantIds */
export const listUnapprovedExpenseGrantIds = (grantIds) =>
  supabase.from('expenses').select('grant_id').in('grant_id', grantIds).neq('status', 'approved');

// Amounts of not-yet-approved expenses, summed on the grantee dashboard.
/** @param {number[]} grantIds */
export const listUnapprovedExpenseAmounts = (grantIds) =>
  supabase.from('expenses').select('amount_spent').in('grant_id', grantIds).neq('status', 'approved');

// expense id → grant_id lookup, used to link audit-log expense rows to a grant.
/** @param {number[]} expenseIds */
export const listExpenseGrantIds = (expenseIds) =>
  supabase.from('expenses').select('id, grant_id').in('id', expenseIds);

// Count of pending expenses across the tenant (admin dashboard tile).
export const countPendingExpenses = () =>
  supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('status', 'pending');

/** @param {number} id */
export const deleteExpense = (id) => supabase.from('expenses').delete().eq('id', id);

/** @param {number} id @param {ExpenseUpdate} updates */
export const updateExpense = (id, updates) =>
  supabase.from('expenses').update(updates).eq('id', id);

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<ExpenseInsert, 'tenant_id'>} expense */
export const insertExpense = (expense) =>
  supabase.from('expenses').insert([expense]).select().single();

// Approve/reject an expense. Throws if the row count is zero — that means RLS
// silently dropped the update, which callers surface as an error. Message text
// is preserved from the inline versions this replaces.
/**
 * @param {number} id
 * @param {ExpenseRow['status']} status
 * @returns {Promise<ExpenseRow[]>}
 */
export async function setExpenseStatus(id, status) {
  const { data, error } = await supabase.from('expenses').update({ status }).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Update was not applied — check RLS policies for expenses.');
  }
  return data;
}
