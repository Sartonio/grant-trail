import { useCallback, useEffect, useState } from "react";
import { getOwnGrant } from "../lib/data/grants";
import { listExpenses } from "../lib/data/expenses";
import { listBudgetItems } from "../lib/data/budgetItems";
import { listReceiptsByGrant } from "../lib/data/receipts";

// Load state for GrantBreakdown: the grantee's own grant plus its budget
// items, expenses, and a receipt lookup map. Exposes `reload` so the page
// can re-fetch after a budget item/expense add/edit/delete (modularity.md,
// Phase 3).
// The caller converts the route-param string to a number at the component
// boundary, so `grantId` is numeric here and in the data layer.
/** @param {number} grantId @param {string|undefined} userId */
export function useGrantBreakdown(grantId, userId) {
  const [grant, setGrant] = useState(
    /** @type {import('../lib/types').GrantRow|null} */ (null),
  );
  const [budgetItems, setBudgetItems] = useState(
    /** @type {import('../lib/types').BudgetItemRow[]} */ ([]),
  );
  const [expenses, setExpenses] = useState(
    /** @type {import('../lib/types').ExpenseRow[]} */ ([]),
  );
  const [receiptMap, setReceiptMap] = useState(
    /** @type {Record<number, any>} */ ({}),
  );
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!userId) return;

    const { data: grantData, error: grantError } = await getOwnGrant(
      grantId,
      userId,
    );
    if (grantError || !grantData) {
      setError("Grant not found.");
      return;
    }
    setGrant(grantData);

    const { data: biData } = await listBudgetItems(grantId);
    setBudgetItems(biData || []);

    const { data: expData } = await listExpenses(grantId);
    setExpenses(expData || []);

    const { data: recData } = await listReceiptsByGrant(grantId);
    const map = /** @type {Record<number, any>} */ ({});
    (recData || []).forEach((r) => {
      const files = /** @type {any[]|null} */ (r.receipt_files);
      if (files && files.length > 0) map[r.expense_id] = files[0];
    });
    setReceiptMap(map);
  }, [grantId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { grant, budgetItems, expenses, receiptMap, error, reload };
}
