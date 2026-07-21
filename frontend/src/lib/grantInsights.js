// Pure grant-activity insights computation for the grantee insights dashboard.
//
// Extracted as a pure module (no supabase imports, injectable input) so the
// aggregation math — submissions per year, status counts, funding requested vs
// awarded, funding-source breakdown, success rate — is unit-tested directly
// (frontend/src/lib/grantInsights.test.js) rather than through the component.
//
// Follows the style of frontend/src/utils/grantsList.js: a pure function over an
// injected array. JSDoc types are plain (decoupled from the generated DB types)
// so this module stays independent of database.types.ts churn.

/**
 * A single grant row, narrowed to the columns this module reads.
 * @typedef {Object} GrantInsightRow
 * @property {number|string} [id]
 * @property {string} [grant_name]
 * @property {string} [status]                pending | approved | needs_changes | declined
 * @property {number|null} [grant_amount]     requested amount
 * @property {number|null} [disbursed_funds]  funds actually disbursed
 * @property {string|null} [funding_source]
 * @property {string|null} [submitted_at]     ISO timestamp (preferred year source)
 * @property {string|null} [created_at]       ISO timestamp (year fallback)
 */

/**
 * Overall (all-time) rollup across every grant.
 * @typedef {Object} OverallInsights
 * @property {number} total
 * @property {number} pending
 * @property {number} approved
 * @property {number} declined
 * @property {number} needsChanges
 * @property {number} requested        Σ grant_amount over all
 * @property {number} awarded          Σ grant_amount over approved
 * @property {number} disbursed        Σ disbursed_funds over all
 * @property {number|null} successRate approved / (approved + declined); null when undecided
 */

/**
 * Per-year rollup.
 * @typedef {Object} YearInsights
 * @property {number} year
 * @property {number} submitted
 * @property {number} pending
 * @property {number} approved
 * @property {number} declined
 * @property {number} needsChanges
 * @property {number} requested
 * @property {number} awarded
 * @property {number|null} successRate
 */

/**
 * Per funding-source rollup.
 * @typedef {Object} SourceInsights
 * @property {string} source
 * @property {number} count
 * @property {number} requested
 * @property {number} awarded
 */

/**
 * @typedef {Object} GrantInsights
 * @property {OverallInsights} overall
 * @property {YearInsights[]} byYear
 * @property {SourceInsights[]} bySource
 */

const UNSPECIFIED = 'Unspecified';

/** Coerce a possibly-null amount to a finite number, treating nullish/NaN as 0.
 * @param {number|string|null|undefined} n @returns {number} */
function amount(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** UTC year of submitted_at, falling back to created_at; null when neither is a valid date.
 * @param {GrantInsightRow} grant @returns {number|null} */
function yearOf(grant) {
  const raw = grant.submitted_at || grant.created_at;
  if (!raw) return null;
  const year = new Date(raw).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

/** Success rate approved / (approved + declined), null when no decided applications.
 * @param {number} approved @param {number} declined @returns {number|null} */
function successRateOf(approved, declined) {
  const decided = approved + declined;
  return decided === 0 ? null : approved / decided;
}

/**
 * Compute the full grant-activity insights projection.
 * @param {GrantInsightRow[]} [grants]
 * @returns {GrantInsights}
 */
export function computeGrantInsights(grants = []) {
  const rows = Array.isArray(grants) ? grants : [];

  const overall = {
    total: rows.length,
    pending: 0,
    approved: 0,
    declined: 0,
    needsChanges: 0,
    requested: 0,
    awarded: 0,
    disbursed: 0,
    successRate: /** @type {number|null} */ (null),
  };

  /** @type {Map<number, YearInsights>} */
  const years = new Map();
  /** @type {Map<string, SourceInsights>} */
  const sources = new Map();

  for (const grant of rows) {
    const status = grant.status;
    const requested = amount(grant.grant_amount);
    const isApproved = status === 'approved';

    // Overall rollup.
    overall.requested += requested;
    overall.disbursed += amount(grant.disbursed_funds);
    if (status === 'pending') overall.pending += 1;
    else if (isApproved) {
      overall.approved += 1;
      overall.awarded += requested;
    } else if (status === 'declined') overall.declined += 1;
    else if (status === 'needs_changes') overall.needsChanges += 1;

    // Per-year rollup (skip rows lacking both dates).
    const year = yearOf(grant);
    if (year !== null) {
      let bucket = years.get(year);
      if (!bucket) {
        bucket = {
          year,
          submitted: 0,
          pending: 0,
          approved: 0,
          declined: 0,
          needsChanges: 0,
          requested: 0,
          awarded: 0,
          successRate: null,
        };
        years.set(year, bucket);
      }
      bucket.submitted += 1;
      bucket.requested += requested;
      if (status === 'pending') bucket.pending += 1;
      else if (isApproved) {
        bucket.approved += 1;
        bucket.awarded += requested;
      } else if (status === 'declined') bucket.declined += 1;
      else if (status === 'needs_changes') bucket.needsChanges += 1;
    }

    // Per funding-source rollup (null/empty grouped under 'Unspecified').
    const key = grant.funding_source && grant.funding_source.trim()
      ? grant.funding_source.trim()
      : UNSPECIFIED;
    let source = sources.get(key);
    if (!source) {
      source = { source: key, count: 0, requested: 0, awarded: 0 };
      sources.set(key, source);
    }
    source.count += 1;
    source.requested += requested;
    if (isApproved) source.awarded += requested;
  }

  overall.successRate = successRateOf(overall.approved, overall.declined);

  const byYear = [...years.values()]
    .sort((a, b) => a.year - b.year)
    .map((y) => ({ ...y, successRate: successRateOf(y.approved, y.declined) }));

  const bySource = [...sources.values()].sort((a, b) => b.requested - a.requested);

  return { overall, byYear, bySource };
}
