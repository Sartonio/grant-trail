// Data-access for the audit_log table (admin audit-log page).
import { createEntityData } from './_factory';

const auditLog = createEntityData('audit_log');

/**
 * A page of audit-log rows, newest first, with an exact total count. Optional
 * filters narrow by table, action, changed-by user, and a local date range
 * (the `from`/`to` yyyy-mm-dd strings are converted to a UTC day span here).
 *
 * @param {Object} opts
 * @param {number} opts.page - Zero-based page index.
 * @param {number} opts.pageSize
 * @param {string} [opts.table] - table_name filter.
 * @param {string} [opts.action] - INSERT | UPDATE | DELETE.
 * @param {string} [opts.user] - changed_by (auth user id).
 * @param {string} [opts.from] - inclusive start date (yyyy-mm-dd, local).
 * @param {string} [opts.to] - inclusive end date (yyyy-mm-dd, local).
 */
export const listAuditLog = ({ page, pageSize, table, action, user, from, to }) => {
  const start = page * pageSize;
  let q = auditLog
    .from()
    .select('id, table_name, action, record_id, changed_by, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(start, start + pageSize - 1);

  if (table) q = q.eq('table_name', table);
  if (action) q = q.eq('action', action);
  if (user) q = q.eq('changed_by', user);
  if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
  if (to) q = q.lte('created_at', new Date(to + 'T23:59:59').toISOString());

  return q;
};

// Old/new value snapshot for a single audit row, fetched lazily on row expand.
/** @param {number} id */
export const getAuditDiff = (id) =>
  auditLog.getBy('id', id, { select: 'old_values, new_values' });
