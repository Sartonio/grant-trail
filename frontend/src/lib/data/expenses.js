// Data-access for the expenses table (modularity.md, Phase 2).
import { createEntityData } from './_factory';
/** @typedef {import('../types').ExpenseRow} ExpenseRow */
/** @typedef {import('../types').ExpenseInsert} ExpenseInsert */
/** @typedef {import('../types').ExpenseUpdate} ExpenseUpdate */

const expenses = createEntityData('expenses');

/** @param {number} grantId */
export const listExpenses = (grantId) => expenses.listBy('grant_id', grantId);

/** @param {number[]} grantIds */
export const listExpensesForGrants = (grantIds) => expenses.listIn('grant_id', grantIds);

// Narrow projection used to build a pending-count map on grant list pages.
/** @param {number[]} grantIds */
export const listUnapprovedExpenseGrantIds = (grantIds) =>
  expenses.listIn('grant_id', grantIds, { select: 'grant_id' }).neq('status', 'approved');

// Amounts of not-yet-approved expenses, summed on the grantee dashboard.
/** @param {number[]} grantIds */
export const listUnapprovedExpenseAmounts = (grantIds) =>
  expenses.listIn('grant_id', grantIds, { select: 'amount_spent' }).neq('status', 'approved');

// expense id → grant_id lookup, used to link audit-log expense rows to a grant.
/** @param {number[]} expenseIds */
export const listExpenseGrantIds = (expenseIds) =>
  expenses.listIn('id', expenseIds, { select: 'id, grant_id' });

// Count of pending expenses across the tenant (admin dashboard tile).
export const countPendingExpenses = () => expenses.countBy('status', 'pending');

/** @param {number} id */
export const deleteExpense = (id) => expenses.deleteBy('id', id);

/** @param {number} id @param {ExpenseUpdate} updates */
export const updateExpense = (id, updates) => expenses.updateBy('id', id, updates);

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<ExpenseInsert, 'tenant_id'>} expense */
export const insertExpense = (expense) => expenses.insert([expense]).select().single();

// Approve/decline an expense. Throws if the row count is zero — that means RLS
// silently dropped the update, which callers surface as an error. Message text
// is preserved from the inline versions this replaces.
/**
 * @param {number} id
 * @param {ExpenseRow['status']} status
 * @returns {Promise<ExpenseRow[]>}
 */
export const setExpenseStatus = (id, status) =>
  expenses.setStatus(id, /** @type {string} */ (status));
