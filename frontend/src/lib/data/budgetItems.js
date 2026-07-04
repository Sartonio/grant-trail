// Data-access for the budget_items table (modularity.md, Phase 2).
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').BudgetItemRow} BudgetItemRow */
/** @typedef {import('../types').BudgetItemInsert} BudgetItemInsert */
/** @typedef {import('../types').BudgetItemUpdate} BudgetItemUpdate */

/** @param {number} grantId */
export const listBudgetItems = (grantId) =>
  supabase.from('budget_items').select('*').eq('grant_id', grantId).order('id');

// Count of pending budget items across the tenant (admin dashboard tile).
export const countPendingBudgetItems = () =>
  supabase.from('budget_items').select('id', { count: 'exact', head: true }).eq('status', 'pending');

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<BudgetItemInsert, 'tenant_id'>} item */
export const insertBudgetItem = (item) =>
  supabase.from('budget_items').insert([item]).select();

/** @param {number} id @param {BudgetItemUpdate} updates */
export const updateBudgetItem = (id, updates) =>
  supabase.from('budget_items').update(updates).eq('id', id).select();

/** @param {number[]} grantIds */
export const listBudgetItemsForGrants = (grantIds) =>
  supabase.from('budget_items').select('*').in('grant_id', grantIds);

/** @param {number} id */
export const deleteBudgetItem = (id) => supabase.from('budget_items').delete().eq('id', id);

// Narrow projections used to build pending-count maps on grant list pages.
/** @param {number[]} grantIds */
export const listPendingBudgetItemGrantIds = (grantIds) =>
  supabase.from('budget_items').select('grant_id').in('grant_id', grantIds).eq('status', 'pending');

/** @param {number[]} grantIds */
export const listUnapprovedBudgetItemGrantIds = (grantIds) =>
  supabase.from('budget_items').select('grant_id').in('grant_id', grantIds).neq('status', 'approved');

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
