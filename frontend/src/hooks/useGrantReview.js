import { useCallback, useEffect, useState } from "react";
import { getGrant } from "../lib/data/grants";
import { listExpenses } from "../lib/data/expenses";
import { listBudgetItems } from "../lib/data/budgetItems";
import { listReceiptsByGrant } from "../lib/data/receipts";
import {
  getGrantee,
  listGrantStatusHistory,
  listGrantComments,
  addGrantComment,
} from "../lib/data/grantReview";

// Load state for AdminGrantReview: the grant + grantee + status history +
// comments + budget items/expenses/receipts. Mutations (approve/decline,
// disbursed funds, etc.) stay in the component since they go through
// useWriteGuard there; this hook owns the read side plus the one
// comment-post affordance the page needs (modularity.md, Phase 3).
// The caller converts the route-param string to a number at the component
// boundary, so `grantId` is numeric here and in the data layer.
/** @param {number} grantId */
export function useGrantReview(grantId) {
  const [grant, setGrant] = useState(
    /** @type {import('../lib/types').GrantRow|null} */ (null),
  );
  const [grantee, setGrantee] = useState(
    /** @type {Awaited<ReturnType<typeof getGrantee>>['data']} */ (null),
  );
  const [history, setHistory] = useState(
    /** @type {NonNullable<Awaited<ReturnType<typeof listGrantStatusHistory>>['data']>} */ ([]),
  );
  const [comments, setComments] = useState(
    /** @type {NonNullable<Awaited<ReturnType<typeof listGrantComments>>['data']>} */ ([]),
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const { data: g, error: gErr } = await getGrant(grantId);
        if (gErr || !g) throw gErr || new Error("Grant not found.");
        setGrant(g);

        const { data: u } = await getGrantee(g.user_id);
        setGrantee(u);

        const { data: hist } = await listGrantStatusHistory(grantId);
        setHistory(hist || []);

        const { data: comms } = await listGrantComments(grantId);
        setComments(comms || []);

        const { data: biData } = await listBudgetItems(grantId);
        setBudgetItems(biData || []);

        const { data: expData } = await listExpenses(grantId);
        setExpenses(expData || []);

        // Receipts — build map: expense_id → first file object
        const { data: recData } = await listReceiptsByGrant(grantId);
        const rMap = /** @type {Record<number, any>} */ ({});
        (recData || []).forEach((r) => {
          const files = /** @type {any[]|null} */ (r.receipt_files);
          if (files && files.length > 0) rMap[r.expense_id] = files[0];
        });
        setReceiptMap(rMap);
      } catch (/** @type {any} */ err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [grantId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Posts a comment then refreshes just the comments list — mirrors the
  // pre-extraction behavior of not re-running the full load().
  const postComment = useCallback(
    /** @param {string} commentText @param {string} userId */
    async (commentText, userId) => {
      const { error: cErr } = await addGrantComment(
        grantId,
        commentText,
        userId,
      );
      if (cErr) throw cErr;
      const { data } = await listGrantComments(grantId);
      setComments(data || []);
    },
    [grantId],
  );

  return {
    grant,
    grantee,
    history,
    comments,
    budgetItems,
    expenses,
    receiptMap,
    loading,
    error,
    reload: load,
    postComment,
  };
}
