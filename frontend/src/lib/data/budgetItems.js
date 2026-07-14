// Data-access for the budget_items table (modularity.md, Phase 2).
import { createEntityData } from './_factory';
/** @typedef {import('../types').BudgetItemRow} BudgetItemRow */
/** @typedef {import('../types').BudgetItemInsert} BudgetItemInsert */
/** @typedef {import('../types').BudgetItemUpdate} BudgetItemUpdate */

const budgetItems = createEntityData('budget_items');
const expenses = createEntityData('expenses');

/** @param {number} grantId */
export const listBudgetItems = (grantId) =>
  budgetItems.listBy('grant_id', grantId, { order: ['id'] });

// Count of pending budget items across the tenant (admin dashboard tile).
export const countPendingBudgetItems = () => budgetItems.countBy('status', 'pending');

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<BudgetItemInsert, 'tenant_id'>} item */
export const insertBudgetItem = (item) => budgetItems.insert([item]).select();

/** @param {number} id @param {BudgetItemUpdate} updates */
export const updateBudgetItem = (id, updates) => budgetItems.updateBy('id', id, updates).select();

/** @param {number[]} grantIds */
export const listBudgetItemsForGrants = (grantIds) => budgetItems.listIn('grant_id', grantIds);

/** @param {number} id */
export const deleteBudgetItem = (id) => budgetItems.deleteBy('id', id);

// Narrow projections used to build pending-count maps on grant list pages.
/** @param {number[]} grantIds */
export const listPendingBudgetItemGrantIds = (grantIds) =>
  budgetItems.listIn('grant_id', grantIds, { select: 'grant_id' }).eq('status', 'pending');

/** @param {number[]} grantIds */
export const listUnapprovedBudgetItemGrantIds = (grantIds) =>
  budgetItems.listIn('grant_id', grantIds, { select: 'grant_id' }).neq('status', 'approved');

// Approve/decline a budget item. Throws on a zero-row update (RLS dropped it),
// preserving the inline error message. When a budget item is declined, its
// linked expenses are reset to 'pending' so an admin handles them individually
// — that cascade lived in a JSX handler before; it now lives here, in one place.
/**
 * @param {number} id
 * @param {BudgetItemRow['status']} status
 * @returns {Promise<BudgetItemRow[]>}
 */
export async function setBudgetItemStatus(id, status) {
  const data = await budgetItems.setStatus(id, /** @type {string} */ (status));
  if (status === 'declined') {
    await expenses.updateBy('budget_item_id', id, { status: 'pending' });
  }
  return data;
}
