// Data-access for the expenses table (modularity.md, Phase 2).
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').ExpenseRow} ExpenseRow */

/** @param {number} grantId */
export const listExpenses = (grantId) =>
  supabase.from('expenses').select('*').eq('grant_id', grantId);

/** @param {number} id */
export const deleteExpense = (id) => supabase.from('expenses').delete().eq('id', id);

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
