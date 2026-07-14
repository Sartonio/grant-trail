// Data-access for the receipts table (modularity.md, Phase 3).
import { createEntityData } from './_factory';
/** @typedef {import('../types').ReceiptInsert} ReceiptInsert */

const receipts = createEntityData('receipts');

// Used to build an expense_id → first receipt file lookup map on the grant
// breakdown and admin review pages.
/** @param {number} grantId */
export const listReceiptsByGrant = (grantId) =>
  receipts.listBy('grant_id', grantId, { select: 'expense_id, receipt_files' });

/** @param {number} expenseId */
export const deleteReceiptByExpense = (expenseId) => receipts.deleteBy('expense_id', expenseId);

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<ReceiptInsert, 'tenant_id'>} receipt */
export const insertReceipt = (receipt) => receipts.insert(receipt);
