// Shared query-shape factory for the lib/data access layer. Each per-entity
// module builds its exports from a createEntityData(table) handle so the
// common CRUD chains — and especially the zero-row RLS-throw guard in
// setStatus — live in exactly one place. Genuine per-entity divergences
// (e.g. the budget-item decline cascade) stay explicit in the entity module,
// layered on these helpers; behavior is pinned by characterization.test.js.
import { supabase } from '../../supabaseClient';

/**
 * Common options for list-shaped helpers.
 * @typedef {Object} ListOpts
 * @property {string} [select] - Columns to select (defaults to '*').
 * @property {any[]} [order] - Arguments for .order(), e.g.
 *   ['created_at', { ascending: false }] or just ['id'].
 */

// Type-preserving: .order() keeps the builder's row type, so the cast back to
// T only erases the (identical) transform-builder wrapper.
/** @template T @param {T} q @param {any[]} [order] @returns {T} */
const applyOrder = (q, order) =>
  order ? /** @type {T} */ (/** @type {any} */ (q).order(...order)) : q;

/**
 * Build the shared data-access helpers for one table (or view).
 * Every helper returns the raw Supabase builder ({ data, error } on await)
 * except setStatus, which resolves to the updated rows or throws.
 *
 * @param {string} table
 */
export const createEntityData = (table) => ({
  // Escape hatch for one-off chains (pagination, upserts) that would turn
  // the helpers below into config-flag spaghetti.
  from: () => supabase.from(table),

  // NOTE: the select-taking helpers are generic over the select string so the
  // literal column list reaches supabase-js's query parser and each caller
  // keeps its precise row type (hooks derive state types from ReturnType).

  /**
   * @template {string} [S='*']
   * @param {{ select?: S, order?: any[] }} [opts]
   */
  listAll: ({ select = /** @type {S} */ ('*'), order } = {}) =>
    applyOrder(supabase.from(table).select(select), order),

  /**
   * @template {string} [S='*']
   * @param {string} column @param {unknown} value
   * @param {{ select?: S, order?: any[] }} [opts]
   */
  listBy: (column, value, { select = /** @type {S} */ ('*'), order } = {}) =>
    applyOrder(supabase.from(table).select(select).eq(column, value), order),

  /**
   * @template {string} [S='*']
   * @param {string} column @param {readonly unknown[]} values
   * @param {{ select?: S }} [opts]
   */
  listIn: (column, values, { select = /** @type {S} */ ('*') } = {}) =>
    supabase.from(table).select(select).in(column, values),

  // Single row by an equality filter (.single(): 0 or 2+ rows is an error).
  /**
   * @template {string} [S='*']
   * @param {string} column @param {unknown} value
   * @param {{ select?: S }} [opts]
   */
  getBy: (column, value, { select = /** @type {S} */ ('*') } = {}) =>
    supabase.from(table).select(select).eq(column, value).single(),

  // Exact head-only count of rows matching an equality filter.
  /** @param {string} column @param {unknown} value */
  countBy: (column, value) =>
    supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, value),

  // Bare insert; the caller chains .select()/.single() (and array-wraps the
  // payload) exactly as its pinned per-entity shape requires.
  /** @param {unknown} payload */
  insert: (payload) => supabase.from(table).insert(payload),

  /** @param {string} column @param {unknown} value @param {Record<string, unknown>} updates */
  updateBy: (column, value, updates) =>
    supabase.from(table).update(updates).eq(column, value),

  /** @param {string} column @param {readonly unknown[]} values @param {Record<string, unknown>} updates */
  updateIn: (column, values, updates) =>
    supabase.from(table).update(updates).in(column, values),

  /** @param {string} column @param {unknown} value */
  deleteBy: (column, value) => supabase.from(table).delete().eq(column, value),

  /** @param {string} column @param {readonly unknown[]} values */
  deleteIn: (column, values) => supabase.from(table).delete().in(column, values),

  // Set a row's status by id. Throws on a supabase error, and on a ZERO-ROW
  // update — that means RLS silently dropped it, which callers must surface.
  // The message text is load-bearing (pinned by characterization tests).
  /** @param {number} id @param {string} status @returns {Promise<any[]>} */
  async setStatus(id, status) {
    const { data, error } = await supabase
      .from(table)
      .update({ status })
      .eq('id', id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error(`Update was not applied — check RLS policies for ${table}.`);
    }
    return data;
  },
});
