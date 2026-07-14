// Shared display formatters. Extracted from components that each defined their
// own copy (see docs/architecture-review/modularity.md, Phase 1). Behavior of
// each function below is a faithful copy of the inline versions it replaces.

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// "5-May-2024" — day-Mon-year, leading zero stripped from the day.
// Accepts a date-only ('YYYY-MM-DD') or ISO timestamp; only the date part is used.
/** @param {string|null|undefined} dateStr */
export function formatDate(dateStr) {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  return `${parseInt(day, 10)}-${MONTHS[parseInt(month, 10) - 1]}-${year}`;
}

// "May 5, 2024" — toLocaleDateString 'short' month style used by the admin screens.
/** @param {string|null|undefined} iso */
export function formatDateMed(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return new Date(+y, +m - 1, +d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// "$1,234.56" (fractionDigits 2) or "$1,235" (fractionDigits 0). null → '—'.
/** @param {number|null|undefined} n @param {number} [fractionDigits] */
export function formatCurrency(n, fractionDigits = 2) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

// "Jul 1, 2026" — toLocaleDateString 'short' style. Accepts a Date, number, or
// ISO/date string (more permissive than formatDateMed, which is date-part only).
/** @param {string|number|Date|null|undefined} ts */
export function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// "12 KB" / "1.5 MB" — human-readable file size. Falsy/0 → em dash.
/** @param {number|null|undefined} bytes */
export function fmtBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "01-Jul-2026" — day-Mon-year, leading zero on the day PRESERVED (unlike
// formatDate). Used by the Excel export and grant breakdown.
/** @param {string|null|undefined} dateStr */
export function formatExcelDate(dateStr) {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  return `${day}-${MONTHS[parseInt(month, 10) - 1]}-${year}`;
}

// Compact "time left" badge for a grant end date (yyyy-mm-dd).
// → { display, cls } — display text + CSS state class.
/** @param {string|null|undefined} endDateStr @returns {{ display: string, cls: string }} */
export function timeRemaining(endDateStr) {
  if (!endDateStr) return { display: "—", cls: "" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDateStr + "T00:00:00");
  const days = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { display: "Expired", cls: "expired" };
  if (days === 0) return { display: "Last day!", cls: "warning" };
  if (days < 30) return { display: `${days}d left`, cls: "warning" };
  const months = Math.floor(days / 30);
  const rem = days % 30;
  const display = rem > 0 ? `${months}mo ${rem}d left` : `${months}mo left`;
  return { display, cls: days < 90 ? "warning" : "" };
}
