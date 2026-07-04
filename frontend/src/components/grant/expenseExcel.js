import * as XLSX from "xlsx";
import { formatExcelDate } from "../../lib/format";

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function toDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMonthKey(value) {
  const date = toDateOnly(value);
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabelFromKey(key) {
  const [year, month] = key.split('-');
  return `${MONTHS[parseInt(month, 10) - 1]}-${year.slice(2)}`;
}

function toSafeSheetName(baseName, usedNames) {
  const sanitized = (baseName || 'Sheet')
    .replace(/[\\/*?:]|\[|\]/g, '-')
    .trim()
    .slice(0, 31) || 'Sheet';

  if (!usedNames.has(sanitized)) {
    usedNames.add(sanitized);
    return sanitized;
  }

  let counter = 2;
  while (counter < 1000) {
    const suffix = `-${counter}`;
    const candidate = `${sanitized.slice(0, 31 - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }

  const fallback = `Sheet-${Date.now()}`.slice(0, 31);
  usedNames.add(fallback);
  return fallback;
}

/**
 * Build a per-month Excel workbook from the already-filtered/sorted expenses and
 * write it to disk. Surfaces validation problems via alert() and returns early,
 * matching the original inline behavior exactly.
 *
 * @param {Object} params
 * @param {Array<Object>} params.sortedExpenses
 * @param {Array<Object>} params.grants
 * @param {Array<Object>} params.budgetItems
 * @param {string} params.dateFrom
 * @param {string} params.dateTo
 */
export function exportExpensesExcel({ sortedExpenses, grants, budgetItems, dateFrom, dateTo }) {
  if (sortedExpenses.length === 0) {
    alert('No expenses found for export.');
    return;
  }

  const selectedStart = toDateOnly(dateFrom);
  const selectedEnd = toDateOnly(dateTo);

  if (selectedStart && selectedEnd && selectedStart > selectedEnd) {
    alert('Start date must be on or before end date.');
    return;
  }

  const filteredForExport = sortedExpenses.filter(exp => {
    const expDate = toDateOnly(exp.expense_date);
    if (!expDate) return false;
    if (selectedStart && expDate < selectedStart) return false;
    if (selectedEnd && expDate > selectedEnd) return false;
    return true;
  });

  if (filteredForExport.length === 0) {
    alert('No expenses found in the selected date range.');
    return;
  }

  const sortedByDate = [...filteredForExport].sort((a, b) => {
    const aTime = toDateOnly(a.expense_date)?.getTime() || 0;
    const bTime = toDateOnly(b.expense_date)?.getTime() || 0;
    return aTime - bTime;
  });

  const expensesByMonth = new Map();
  sortedByDate.forEach((exp) => {
    const monthKey = toMonthKey(exp.expense_date);
    if (!monthKey) return;
    if (!expensesByMonth.has(monthKey)) expensesByMonth.set(monthKey, []);
    expensesByMonth.get(monthKey).push(exp);
  });

  if (expensesByMonth.size === 0) {
    alert('No expenses found in the selected date range.');
    return;
  }

  const monthKeys = Array.from(expensesByMonth.keys()).sort();
  const grantById = new Map(grants.map(g => [g.id, g]));
  const budgetItemById = new Map(budgetItems.map(bi => [bi.id, bi]));

  const runningTotalByExpenseId = new Map();
  let runningAcrossRange = 0;
  sortedByDate.forEach((exp) => {
    const expAmount = Number(exp.amount_spent || 0);
    runningAcrossRange += expAmount;
    runningTotalByExpenseId.set(exp.id, runningAcrossRange);
  });

  const trailingLabels = [
    'Expense Date',
    'Amount Spent to date for project',
    'Actual expenditure',
    'Total Expenditures',
    'Available Amount / Grant',
    'Budgeted per expenditure',
    'Difference (Budget vs Actual)',
    'Other Expenditures Comment',
  ];
  const trailingStartCol = 9;
  const totalCols = trailingStartCol + trailingLabels.length;

  const headerRow1 = new Array(totalCols).fill('');
  const headerRow2 = new Array(totalCols).fill('');

  headerRow1[0] = 'Funding Source';
  headerRow1[1] = 'Effective Dates';
  headerRow2[1] = 'Start';
  headerRow2[2] = 'End';
  headerRow1[3] = 'Identification';
  headerRow2[3] = 'Project Title';
  headerRow1[4] = 'Total Grant Amount';
  headerRow2[4] = 'Budgeted';
  headerRow2[5] = 'Received';
  headerRow1[6] = 'Balance';
  headerRow2[6] = 'Forwarded from previous year';
  headerRow2[7] = 'Available for Period';
  headerRow1[8] = 'Expenditures';
  headerRow2[8] = 'Expenditures';

  trailingLabels.forEach((label, index) => {
    const col = trailingStartCol + index;
    headerRow1[col] = label;
  });

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  monthKeys.forEach((monthKey) => {
    const monthExpenses = expensesByMonth.get(monthKey) || [];

    const dataRows = monthExpenses.map((exp) => {
      const grant = grantById.get(exp.grant_id);
      const budgetItem = budgetItemById.get(exp.budget_item_id);
      const expAmount = Number(exp.amount_spent || 0);
      const runningTotal = runningTotalByExpenseId.get(exp.id) || 0;
      const budgetAllocated = Number(budgetItem?.budget_allocated || 0);
      const budgetItemSpent = Number(budgetItem?.amount_spent || 0);

      const projectGrantTotal = Number(grant?.grant_amount || 0);
      const projectTotalSpent = Number(grant?.total_spent || 0);
      const projectReceived = Number(grant?.disbursed_funds || 0);
      const periodStart = dateFrom || grant?.start_spend_period || '';
      const periodEnd = dateTo || grant?.end_spend_period || '';

      return [
        grant?.grant_name || `Grant #${exp.grant_id}`,
        formatExcelDate(periodStart),
        formatExcelDate(periodEnd),
        budgetItem?.item_name || grant?.grant_name || `Grant #${exp.grant_id}`,
        projectGrantTotal,
        projectReceived,
        0,
        projectGrantTotal,
        exp.item_name || '',
        formatExcelDate(exp.expense_date),
        runningTotal,
        expAmount,
        projectTotalSpent || runningTotal,
        projectGrantTotal - runningTotal,
        budgetAllocated,
        budgetAllocated - budgetItemSpent,
        budgetItem?.description || '',
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headerRow1, headerRow2, ...dataRows]);

    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 0, c: 5 } },
      { s: { r: 0, c: 6 }, e: { r: 0, c: 7 } },
      { s: { r: 0, c: 8 }, e: { r: 1, c: 8 } },
    ];

    trailingLabels.forEach((_, index) => {
      const c = trailingStartCol + index;
      merges.push({ s: { r: 0, c }, e: { r: 1, c } });
    });

    ws['!merges'] = merges;
    ws['!cols'] = [
      { wch: 24 },
      { wch: 12 },
      { wch: 12 },
      { wch: 28 },
      { wch: 13 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 36 },
      { wch: 12 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 },
      { wch: 22 },
      { wch: 28 },
    ];

    const sheetLabel = monthLabelFromKey(monthKey);
    const sheetName = toSafeSheetName(sheetLabel, usedSheetNames);
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  });

  const fileSuffix = [dateFrom || 'all', dateTo || 'all'].join('_to_');
  XLSX.writeFile(workbook, `expense-report-excel_${fileSuffix}.xlsx`);
}
