-- ============================================================
-- 11-Randomize-Expense-Dates.sql
-- Updates all existing expense rows so that expense_date falls
-- on a random day within the grant's spend period.
--
-- Safe to re-run: each execution picks new random dates.
-- Skips expenses whose grant has no start/end spend period.
-- ============================================================

UPDATE expenses e
SET    expense_date = (
         gr.start_spend_period
         + (random() * (gr.end_spend_period - gr.start_spend_period))::int
       )
FROM   grant_record gr
WHERE  e.grant_id            = gr.id
  AND  gr.start_spend_period IS NOT NULL
  AND  gr.end_spend_period   IS NOT NULL;

-- Optional: verify the results
-- SELECT
--   e.id,
--   e.item_name,
--   e.expense_date,
--   gr.start_spend_period,
--   gr.end_spend_period
-- FROM expenses e
-- JOIN grant_record gr ON gr.id = e.grant_id
-- ORDER BY gr.id, e.expense_date;
