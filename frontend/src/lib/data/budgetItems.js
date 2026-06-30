// Data-access for the budget_items table (modularity.md, Phase 2).
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').BudgetItemRow} BudgetItemRow */

/** @param {number} grantId */
export const listBudgetItems = (grantId) =>
  supabase.from('budget_items').select('*').eq('grant_id', grantId).order('id');

/** @param {number} id */
export const deleteBudgetItem = (id) => supabase.from('budget_items').delete().eq('id', id);

// Approve/reject a budget item. Throws on a zero-row update (RLS dropped it),
// preserving the inline error message. When a budget item is rejected, its
// linked expenses are reset to 'pending' so an admin handles them individually
// — that cascade lived in a JSX handler before; it now lives here, in one place.
/**
 * @param {number} id
 * @param {BudgetItemRow['status']} status
 * @returns {Promise<BudgetItemRow[]>}
 */
export async function setBudgetItemStatus(id, status) {
  const { data, error } = await supabase
    .from('budget_items')
    .update({ status })
    .eq('id', id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Update was not applied — check RLS policies for budget_items.');
  }
  if (status === 'rejected') {
    await supabase.from('expenses').update({ status: 'pending' }).eq('budget_item_id', id);
  }
  return data;
}
