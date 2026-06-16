# React & Supabase Development Patterns

This guide explains the non-obvious design, database, and React patterns used throughout the GrantTrail codebase.

---

## 1. Supabase Row Level Security (RLS) Silent Failures

When a database policy denies access to a select query, Supabase returns **`data: null` and `error: null`** — it does not throw a query exception.

```js
// A grantee trying to view another user's grant:
const { data, error } = await supabase
  .from('grant_record')
  .select('*')
  .eq('id', someOthersGrantId)
  .single();

// Result:  data = null,  error = null
// NOT:     error = { message: 'Access denied' }
```

React components must always check for a null return value before dereferencing properties:

```js
if (!data) {
  setError('Grant not found.');
  return;
}
setGrant(data);
```
*Reference files:* [GrantDetail.js](../../frontend/src/components/GrantDetail.js), [GrantBreakdown.js](../../frontend/src/components/GrantBreakdown.js)

---

## 2. Trigger-Based Database Computations
Do not manually calculate or insert derived data on the frontend. The database handles this via triggers:

- **Status History Logging**: When `grant_record.status` is updated, the `trg_grant_status_tracking` trigger automatically writes a record to `grant_status_history`.
- **Budget & Grant Spending Aggregations**: Inserting, updating, or deleting `expenses` automatically recalculates `budget_items.amount_spent`, `grant_record.total_spent`, and `grant_record.remaining_balance`.
  - *Note:* Only **approved** expenses contribute to spending calculations. Pending or rejected entries do not.

---

## 3. Short-Lived Storage Signed URLs
Supabase Storage buckets are private. Files cannot be accessed using public URLs. Instead, generate a short-lived (e.g., 60-second) signed URL to let users view files:

```js
// GrantAttachments.js
const { data, error } = await supabase.storage
  .from('grant-documents')
  .createSignedUrl(att.file_path, 60);   // 60-second expiry

if (data?.signedUrl) {
  window.open(data.signedUrl, '_blank'); // Open file in a new tab
}
```
*Reference file:* [GrantAttachments.js](../../frontend/src/components/GrantAttachments.js) (the `handleView` function)

---

## 4. Storage & DB Compensating Transactions
Supabase does not support client-side transactions across database and storage operations. If a file is uploaded to Storage, but the subsequent database row insertion fails, the storage file becomes an orphan.

To prevent this, implement a manual compensating delete in your `catch` blocks:

```js
// GrantAttachments.js — upload first, then DB insert
const { error: uploadErr } = await supabase.storage
  .from('grant-documents')
  .upload(storagePath, file);

if (uploadErr) throw new Error(uploadErr.message);

const { error: dbErr } = await supabase.from('grant_attachments').insert({ ...payload });
if (dbErr) {
  // Compensate: delete the orphaned file from Storage
  await supabase.storage.from('grant-documents').remove([storagePath]);
  throw dbErr;
}
```
*Reference files:* [GrantAttachments.js](../../frontend/src/components/GrantAttachments.js), [AddExpenseModal.js](../../frontend/src/components/AddExpenseModal.js)

---

## 5. `useCallback` + `useEffect` Data Fetching
To define asynchronous data-fetching functions that are invoked on component mount **and** manually on events (such as button clicks), wrap the fetch method in `useCallback`. This prevents infinite rendering loops when listed as a dependency of `useEffect`:

```js
// AdminGrantReview.js
const load = useCallback(async () => {
  const { data: g } = await supabase.from('grant_record').select('*').eq('id', id).single();
  setGrant(g);
  // ... more fetching
}, [id]);  // only recreates the function if the ID changes

useEffect(() => {
  load();
}, [load]);  // safe to run when load reference changes
```
*Reference file:* [AdminGrantReview.js](../../frontend/src/components/AdminGrantReview.js)

---

## 6. Inline JSX Computations (IIFE)
For rendering derived charts or calculations from state arrays without creating secondary states or separate effects, use Immediately Invoked Function Expressions (IIFEs) inside JSX:

```jsx
// ExpenseReports.js
{items.length > 0 && (() => {
  const monthlyMap = {};
  items.forEach(item => { ... });
  const monthlyData = Object.entries(monthlyMap).map(...);

  return (
    <div className="charts-row">
      <BarChart data={monthlyData} ... />
    </div>
  );
})()}
```
*Reference files:* [ExpenseReports.js](../../frontend/src/components/ExpenseReports.js), [GrantDetail.js](../../frontend/src/components/GrantDetail.js)

---

## 7. Two-Click Deletions (No Modals)
To prevent disruptive popup modal overlays, simple delete actions (such as removing a document attachment) use a two-click arming state pattern:

```js
// GrantAttachments.js
const [deletingId, setDeletingId] = useState(null);

const handleDelete = async (att) => {
  if (deletingId !== att.id) {
    setDeletingId(att.id);  // First click: arm
    return;
  }
  // Second click: delete
  await supabase.storage.from('grant-documents').remove([att.file_path]);
  await supabase.from('grant_attachments').delete().eq('id', att.id);
  setDeletingId(null);
  await fetchAttachments();
};
```
And render conditionally:
```jsx
{deletingId === att.id ? (
  <div className="ga-confirm-delete">
    <span>Delete?</span>
    <button onClick={() => handleDelete(att)}>Yes</button>
    <button onClick={() => setDeletingId(null)}>No</button>
  </div>
) : (
  <button onClick={() => handleDelete(att)}>Delete</button>
)}
```
*Reference file:* [GrantAttachments.js](../../frontend/src/components/GrantAttachments.js)

---

## 8. O(1) Lookups Using JavaScript Sets
When matching statuses or checking memberships inside large table rendering loops, collect the keys in a `Set` to perform `O(1)` checks rather than scanning arrays with `find()` or `includes()` (which is `O(n)`):

```js
// Grants.js
const [grantsWithPendingItems, setGrantsWithPendingItems] = useState(new Set());
// ... fetch list of pending items -> setGrantsWithPendingItems(new Set(pendingIds))

// In render loop
{grantsWithPendingItems.has(grant.id) && (
  <span className="grant-pending-flag">Pending...</span>
)}
```
*Reference file:* [Grants.js](../../frontend/src/components/Grants.js)

---

## 9. Batching Related Queries (`.in()`)
To avoid running multiple nested loops (N+1 queries), load parent keys, map them into an array of IDs, and fetch child rows in a single batch query:

```js
// Step 1: Get all user's grants
const { data: grants } = await supabase.from('grant_record').select('*');

// Step 2: Fetch all expenses for all those grants at once
const { data: expenses } = await supabase
  .from('expenses')
  .select('*')
  .in('grant_id', grants.map(g => g.id));
```
*Reference file:* [ExpenseReports.js](../../frontend/src/components/ExpenseReports.js)

---

## 10. `.single()` vs Array Results
By default, Supabase returns queries as arrays. For queries that must return exactly one record (e.g. by unique primary key), chain `.single()` to receive a single object rather than an array:

```js
const { data } = await supabase.from('grant_record').select('*').eq('id', id).single();
// returns data = { id: 1, ... } instead of data = [ { id: 1, ... } ]
```
*Reference files:* [App.js](../../frontend/src/App.js), [GrantDetail.js](../../frontend/src/components/GrantDetail.js)

---

## 11. Intentional Dependency Rule Disables
When defining effects that should run strictly when primary keys change, but use methods defined inside components, bypass the `exhaustive-deps` linter warnings intentionally using inline comments rather than introducing wrapping functions:

```js
useEffect(() => {
  if (grantId) fetchAttachments();
}, [grantId]); // eslint-disable-line react-hooks/exhaustive-deps
```
*Reference file:* [GrantAttachments.js](../../frontend/src/components/GrantAttachments.js)

---

## 12. Backdrop Click Modal Closure
Modals close when clicking outside the dialog content box by validating the class list of the target:

```js
const handleBackdropClick = (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    onClose();
  }
};
```
*Reference file:* [AddExpenseModal.js](../../frontend/src/components/AddExpenseModal.js)
