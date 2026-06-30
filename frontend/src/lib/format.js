// Shared display formatters. Extracted from components that each defined their
// own copy (see docs/architecture-review/modularity.md, Phase 1). Behavior of
// each function below is a faithful copy of the inline versions it replaces.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "5-May-2024" — day-Mon-year, leading zero stripped from the day.
// Accepts a date-only ('YYYY-MM-DD') or ISO timestamp; only the date part is used.
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${parseInt(day, 10)}-${MONTHS[parseInt(month, 10) - 1]}-${year}`;
}

// "May 5, 2024" — toLocaleDateString 'short' month style used by the admin screens.
export function formatDateMed(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// "$1,234.56" (fractionDigits 2) or "$1,235" (fractionDigits 0). null → '—'.
export function formatCurrency(n, fractionDigits = 2) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: fractionDigits,
  }).format(n);
}
