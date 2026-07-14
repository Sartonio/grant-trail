import { useEffect, useState } from "react";
import { listGrantsForUser } from "../lib/data/grants";
import { listExpensesForGrants } from "../lib/data/expenses";
import { listBudgetItemsForGrants } from "../lib/data/budgetItems";

// Load state for ExpenseReports: every grant owned by the current grantee
// plus all expenses/budget items across them, used to drive the filters,
// charts, and exports on the expense reports page (modularity.md, Phase 3).
/** @typedef {import('../lib/types').Session} Session */

/** @param {Session|null} [session] */
export function useExpenseReports(session) {
  const [grants, setGrants] = useState(
    /** @type {NonNullable<Awaited<ReturnType<typeof listGrantsForUser>>['data']>} */ ([]),
  );
  const [items, setItems] = useState(
    /** @type {NonNullable<Awaited<ReturnType<typeof listExpensesForGrants>>['data']>} */ ([]),
  );
  const [budgetItems, setBudgetItems] = useState(
    /** @type {NonNullable<Awaited<ReturnType<typeof listBudgetItemsForGrants>>['data']>} */ ([]),
  );

  useEffect(() => {
    async function fetchData() {
      if (!session?.userRecord) return;

      const { data: grantData, error: grantError } = await listGrantsForUser(
        session.userRecord.id,
      );
      const grantIds = grantData?.map((g) => g.id) || [];

      const { data: itemData, error: itemError } =
        await listExpensesForGrants(grantIds);
      const { data: budgetItemData, error: budgetItemError } =
        await listBudgetItemsForGrants(grantIds);

      if (!grantError) setGrants(grantData || []);
      if (!itemError) setItems(itemData || []);
      if (!budgetItemError) setBudgetItems(budgetItemData || []);
    }

    fetchData();
  }, [session]);

  return { grants, items, budgetItems };
}
