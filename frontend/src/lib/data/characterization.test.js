// Characterization tests for the lib/data access layer. These pin the EXACT
// current behavior of every exported function — the supabase query chain each
// builds (table, method order, arguments) and data/error passthrough —
// including inconsistencies between modules (pinned AS-IS; see DEBT.md).
// Written BEFORE the factory refactor; the factory must keep them green
// unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ chains: [], results: {} }));
const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock('../../supabaseClient', () => ({ supabase: { from: fromMock, rpc: rpcMock } }));

import * as attachments from './attachments';
import * as auditLog from './auditLog';
import * as budgetItems from './budgetItems';
import * as expenses from './expenses';
import * as fiscalAgentListings from './fiscalAgentListings';
import * as grantReview from './grantReview';
import * as grants from './grants';
import * as inquiries from './inquiries';
import * as notifications from './notifications';
import * as receipts from './receipts';
import * as tenantMemberships from './tenantMemberships';
import * as tenants from './tenants';
import * as users from './users';

const METHODS = [
  'select',
  'insert',
  'update',
  'upsert',
  'delete',
  'eq',
  'neq',
  'in',
  'gte',
  'lte',
  'order',
  'limit',
  'range',
  'single',
  'maybeSingle',
];

const DEFAULT_RESULT = { data: [{ id: 1 }], error: null };

function makeChain(getResult) {
  const calls = [];
  /** @type {Record<string, any>} */
  const chain = { calls };
  for (const m of METHODS) {
    chain[m] = (...args) => {
      calls.push([m, ...args]);
      return chain;
    };
  }
  chain.then = (resolve) => resolve(getResult());
  return chain;
}

beforeEach(() => {
  state.chains = [];
  state.results = {};
  fromMock.mockReset().mockImplementation((table) => {
    const chain = makeChain(() => state.results[table] ?? DEFAULT_RESULT);
    state.chains.push({ table, calls: chain.calls });
    return chain;
  });
  rpcMock.mockReset().mockResolvedValue({ data: null, error: null });
});

// Assert the i-th supabase.from() call hit `table` and built exactly `calls`.
const expectChain = (i, table, calls) => {
  expect(state.chains[i]).toBeDefined();
  expect(state.chains[i].table).toBe(table);
  expect(state.chains[i].calls).toEqual(calls);
};

// Await a query and assert the supabase result passes through untouched.
const expectPassthrough = async (query) => {
  await expect(query).resolves.toEqual(DEFAULT_RESULT);
};

describe('attachments', () => {
  it('listGrantAttachments', async () => {
    await expectPassthrough(attachments.listGrantAttachments(7));
    expectChain(0, 'grant_attachments', [
      ['select', '*'],
      ['eq', 'grant_id', 7],
      ['order', 'created_at', { ascending: false }],
    ]);
  });

  it('insertGrantAttachment — bare insert, payload NOT array-wrapped, no select', async () => {
    const row = { grant_id: 7, file_path: 'a.pdf' };
    await expectPassthrough(attachments.insertGrantAttachment(row));
    expectChain(0, 'grant_attachments', [['insert', row]]);
  });

  it('deleteGrantAttachment', async () => {
    await expectPassthrough(attachments.deleteGrantAttachment(3));
    expectChain(0, 'grant_attachments', [['delete'], ['eq', 'id', 3]]);
  });
});

describe('auditLog', () => {
  it('listAuditLog with no filters — paged, exact count, newest first', async () => {
    await expectPassthrough(auditLog.listAuditLog({ page: 2, pageSize: 25 }));
    expectChain(0, 'audit_log', [
      ['select', 'id, table_name, action, record_id, changed_by, created_at', { count: 'exact' }],
      ['order', 'created_at', { ascending: false }],
      ['range', 50, 74],
    ]);
  });

  it('listAuditLog applies every optional filter, dates as local-day UTC span', async () => {
    await expectPassthrough(
      auditLog.listAuditLog({
        page: 0,
        pageSize: 10,
        table: 'expenses',
        action: 'UPDATE',
        user: 'uid-1',
        from: '2026-01-02',
        to: '2026-01-03',
      })
    );
    expectChain(0, 'audit_log', [
      ['select', 'id, table_name, action, record_id, changed_by, created_at', { count: 'exact' }],
      ['order', 'created_at', { ascending: false }],
      ['range', 0, 9],
      ['eq', 'table_name', 'expenses'],
      ['eq', 'action', 'UPDATE'],
      ['eq', 'changed_by', 'uid-1'],
      ['gte', 'created_at', new Date('2026-01-02T00:00:00').toISOString()],
      ['lte', 'created_at', new Date('2026-01-03T23:59:59').toISOString()],
    ]);
  });

  it('getAuditDiff', async () => {
    await expectPassthrough(auditLog.getAuditDiff(11));
    expectChain(0, 'audit_log', [
      ['select', 'old_values, new_values'],
      ['eq', 'id', 11],
      ['single'],
    ]);
  });
});

describe('budgetItems', () => {
  it('listBudgetItems', async () => {
    await expectPassthrough(budgetItems.listBudgetItems(7));
    expectChain(0, 'budget_items', [
      ['select', '*'],
      ['eq', 'grant_id', 7],
      ['order', 'id'],
    ]);
  });

  it('countPendingBudgetItems', async () => {
    await expectPassthrough(budgetItems.countPendingBudgetItems());
    expectChain(0, 'budget_items', [
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'status', 'pending'],
    ]);
  });

  it('insertBudgetItem — payload IS array-wrapped, bare .select()', async () => {
    const item = { grant_id: 7, item: 'chairs' };
    await expectPassthrough(budgetItems.insertBudgetItem(item));
    expectChain(0, 'budget_items', [['insert', [item]], ['select']]);
  });

  it('updateBudgetItem — trailing bare .select()', async () => {
    await expectPassthrough(budgetItems.updateBudgetItem(3, { item: 'desks' }));
    expectChain(0, 'budget_items', [
      ['update', { item: 'desks' }],
      ['eq', 'id', 3],
      ['select'],
    ]);
  });

  it('listBudgetItemsForGrants', async () => {
    await expectPassthrough(budgetItems.listBudgetItemsForGrants([1, 2]));
    expectChain(0, 'budget_items', [
      ['select', '*'],
      ['in', 'grant_id', [1, 2]],
    ]);
  });

  it('deleteBudgetItem', async () => {
    await expectPassthrough(budgetItems.deleteBudgetItem(3));
    expectChain(0, 'budget_items', [['delete'], ['eq', 'id', 3]]);
  });

  it('listPendingBudgetItemGrantIds', async () => {
    await expectPassthrough(budgetItems.listPendingBudgetItemGrantIds([1, 2]));
    expectChain(0, 'budget_items', [
      ['select', 'grant_id'],
      ['in', 'grant_id', [1, 2]],
      ['eq', 'status', 'pending'],
    ]);
  });

  it('listUnapprovedBudgetItemGrantIds', async () => {
    await expectPassthrough(budgetItems.listUnapprovedBudgetItemGrantIds([1, 2]));
    expectChain(0, 'budget_items', [
      ['select', 'grant_id'],
      ['in', 'grant_id', [1, 2]],
      ['neq', 'status', 'approved'],
    ]);
  });

  describe('setBudgetItemStatus', () => {
    it('success returns the updated rows (not { data, error })', async () => {
      const rows = await budgetItems.setBudgetItemStatus(3, 'approved');
      expect(rows).toEqual([{ id: 1 }]);
      expectChain(0, 'budget_items', [
        ['update', { status: 'approved' }],
        ['eq', 'id', 3],
        ['select'],
      ]);
      expect(state.chains).toHaveLength(1);
    });

    it('zero rows throws the exact RLS message and skips the cascade', async () => {
      state.results.budget_items = { data: [], error: null };
      await expect(budgetItems.setBudgetItemStatus(3, 'declined')).rejects.toThrow(
        'Update was not applied — check RLS policies for budget_items.'
      );
      expect(state.chains).toHaveLength(1); // expenses never touched
    });

    it('null data also throws the RLS message', async () => {
      state.results.budget_items = { data: null, error: null };
      await expect(budgetItems.setBudgetItemStatus(3, 'approved')).rejects.toThrow(
        'Update was not applied — check RLS policies for budget_items.'
      );
    });

    it('propagates the supabase error object as thrown', async () => {
      const boom = new Error('rls boom');
      state.results.budget_items = { data: null, error: boom };
      await expect(budgetItems.setBudgetItemStatus(3, 'approved')).rejects.toBe(boom);
    });

    it('declining cascades a pending-reset to linked expenses', async () => {
      await budgetItems.setBudgetItemStatus(3, 'declined');
      expectChain(1, 'expenses', [
        ['update', { status: 'pending' }],
        ['eq', 'budget_item_id', 3],
      ]);
    });

    it('approving does NOT touch expenses', async () => {
      await budgetItems.setBudgetItemStatus(3, 'approved');
      expect(state.chains).toHaveLength(1);
    });

    it('a cascade error throws with a descriptive message', async () => {
      state.results.expenses = { data: null, error: new Error('cascade failed') };
      await expect(budgetItems.setBudgetItemStatus(3, 'declined')).rejects.toThrow(
        'Budget item was declined, but resetting its linked expenses to pending failed: cascade failed'
      );
    });

    it('a zero-row cascade is NOT an error (no linked expenses)', async () => {
      state.results.expenses = { data: [], error: null };
      const rows = await budgetItems.setBudgetItemStatus(3, 'declined');
      expect(rows).toEqual([{ id: 1 }]);
    });
  });
});

describe('expenses', () => {
  it('listExpenses', async () => {
    await expectPassthrough(expenses.listExpenses(7));
    expectChain(0, 'expenses', [
      ['select', '*'],
      ['eq', 'grant_id', 7],
    ]);
  });

  it('listExpensesForGrants', async () => {
    await expectPassthrough(expenses.listExpensesForGrants([1, 2]));
    expectChain(0, 'expenses', [
      ['select', '*'],
      ['in', 'grant_id', [1, 2]],
    ]);
  });

  it('listUnapprovedExpenseGrantIds', async () => {
    await expectPassthrough(expenses.listUnapprovedExpenseGrantIds([1, 2]));
    expectChain(0, 'expenses', [
      ['select', 'grant_id'],
      ['in', 'grant_id', [1, 2]],
      ['neq', 'status', 'approved'],
    ]);
  });

  it('listUnapprovedExpenseAmounts', async () => {
    await expectPassthrough(expenses.listUnapprovedExpenseAmounts([1, 2]));
    expectChain(0, 'expenses', [
      ['select', 'amount_spent'],
      ['in', 'grant_id', [1, 2]],
      ['neq', 'status', 'approved'],
    ]);
  });

  it('listExpenseGrantIds', async () => {
    await expectPassthrough(expenses.listExpenseGrantIds([9, 10]));
    expectChain(0, 'expenses', [
      ['select', 'id, grant_id'],
      ['in', 'id', [9, 10]],
    ]);
  });

  it('countPendingExpenses', async () => {
    await expectPassthrough(expenses.countPendingExpenses());
    expectChain(0, 'expenses', [
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'status', 'pending'],
    ]);
  });

  it('deleteExpense', async () => {
    await expectPassthrough(expenses.deleteExpense(3));
    expectChain(0, 'expenses', [['delete'], ['eq', 'id', 3]]);
  });

  it('updateExpense — no trailing .select() (unlike updateBudgetItem)', async () => {
    await expectPassthrough(expenses.updateExpense(3, { amount_spent: 10 }));
    expectChain(0, 'expenses', [
      ['update', { amount_spent: 10 }],
      ['eq', 'id', 3],
    ]);
  });

  it('insertExpense — payload array-wrapped, .select().single()', async () => {
    const row = { grant_id: 7, amount_spent: 10 };
    await expectPassthrough(expenses.insertExpense(row));
    expectChain(0, 'expenses', [['insert', [row]], ['select'], ['single']]);
  });

  describe('setExpenseStatus', () => {
    it('success returns the updated rows', async () => {
      const rows = await expenses.setExpenseStatus(3, 'approved');
      expect(rows).toEqual([{ id: 1 }]);
      expectChain(0, 'expenses', [
        ['update', { status: 'approved' }],
        ['eq', 'id', 3],
        ['select'],
      ]);
    });

    it('zero rows throws the exact RLS message', async () => {
      state.results.expenses = { data: [], error: null };
      await expect(expenses.setExpenseStatus(3, 'approved')).rejects.toThrow(
        'Update was not applied — check RLS policies for expenses.'
      );
    });

    it('null data also throws the RLS message', async () => {
      state.results.expenses = { data: null, error: null };
      await expect(expenses.setExpenseStatus(3, 'approved')).rejects.toThrow(
        'Update was not applied — check RLS policies for expenses.'
      );
    });

    it('propagates the supabase error object as thrown', async () => {
      const boom = new Error('rls boom');
      state.results.expenses = { data: null, error: boom };
      await expect(expenses.setExpenseStatus(3, 'approved')).rejects.toBe(boom);
    });
  });
});

describe('fiscalAgentListings', () => {
  it('getTenantListing coerces tenantId to Number', async () => {
    await expectPassthrough(fiscalAgentListings.getTenantListing('4'));
    expectChain(0, 'fiscal_agent_listings', [
      ['select', '*'],
      ['eq', 'tenant_id', 4],
      ['order', 'updated_at', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('listPublishedListings', async () => {
    await expectPassthrough(fiscalAgentListings.listPublishedListings());
    expectChain(0, 'fiscal_agent_listings', [
      ['select', '*'],
      ['eq', 'status', 'published'],
      ['eq', 'verification', 'verified'],
    ]);
  });

  it('listPublicListings reads the public view', async () => {
    await expectPassthrough(fiscalAgentListings.listPublicListings());
    expectChain(0, 'fiscal_agent_listings_public', [['select', '*']]);
  });

  it('getListing — Number id, published+verified only, maybeSingle', async () => {
    await expectPassthrough(fiscalAgentListings.getListing('9'));
    expectChain(0, 'fiscal_agent_listings', [
      ['select', '*'],
      ['eq', 'id', 9],
      ['eq', 'status', 'published'],
      ['eq', 'verification', 'verified'],
      ['maybeSingle'],
    ]);
  });

  it('getPublicListing', async () => {
    await expectPassthrough(fiscalAgentListings.getPublicListing('9'));
    expectChain(0, 'fiscal_agent_listings_public', [
      ['select', '*'],
      ['eq', 'id', 9],
      ['maybeSingle'],
    ]);
  });

  it('updateListing — Number id', async () => {
    await expectPassthrough(fiscalAgentListings.updateListing('9', { accepting: false }));
    expectChain(0, 'fiscal_agent_listings', [
      ['update', { accepting: false }],
      ['eq', 'id', 9],
    ]);
  });

  it('listPendingListings — oldest first', async () => {
    await expectPassthrough(fiscalAgentListings.listPendingListings());
    expectChain(0, 'fiscal_agent_listings', [
      ['select', '*'],
      ['eq', 'verification', 'pending'],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('setListingVerification syncs the legacy verified boolean and returns rows', async () => {
    const rows = await fiscalAgentListings.setListingVerification(9, 'verified');
    expect(rows).toEqual([{ id: 1 }]);
    expectChain(0, 'fiscal_agent_listings', [
      ['update', { verification: 'verified', verified: true }],
      ['eq', 'id', 9],
      ['select'],
    ]);
  });

  it('setListingVerification declined sets verified false', async () => {
    await fiscalAgentListings.setListingVerification(9, 'declined');
    expectChain(0, 'fiscal_agent_listings', [
      ['update', { verification: 'declined', verified: false }],
      ['eq', 'id', 9],
      ['select'],
    ]);
  });

  it('setListingVerification zero rows throws the exact RLS message', async () => {
    state.results.fiscal_agent_listings = { data: [], error: null };
    await expect(fiscalAgentListings.setListingVerification(9, 'verified')).rejects.toThrow(
      'Update was not applied — check RLS policies for fiscal_agent_listings.'
    );
  });

  it('setListingVerification null data also throws the RLS message', async () => {
    state.results.fiscal_agent_listings = { data: null, error: null };
    await expect(fiscalAgentListings.setListingVerification(9, 'declined')).rejects.toThrow(
      'Update was not applied — check RLS policies for fiscal_agent_listings.'
    );
  });

  it('setListingVerification propagates the supabase error object as thrown', async () => {
    const boom = new Error('rls boom');
    state.results.fiscal_agent_listings = { data: null, error: boom };
    await expect(fiscalAgentListings.setListingVerification(9, 'verified')).rejects.toBe(boom);
  });
});

describe('grantReview', () => {
  it('getGrantee reads a narrow users projection', async () => {
    await expectPassthrough(grantReview.getGrantee('uid-1'));
    expectChain(0, 'users', [
      ['select', 'firstname, lastname, organization_name, email'],
      ['eq', 'id', 'uid-1'],
      ['single'],
    ]);
  });

  it('listGrantStatusHistory', async () => {
    await expectPassthrough(grantReview.listGrantStatusHistory(7));
    expectChain(0, 'grant_status_history', [
      ['select', '*'],
      ['eq', 'grant_id', 7],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('listGrantComments', async () => {
    await expectPassthrough(grantReview.listGrantComments(7));
    expectChain(0, 'grant_comments', [
      ['select', '*'],
      ['eq', 'grant_id', 7],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('addGrantComment — bare insert of a composed row', async () => {
    await expectPassthrough(grantReview.addGrantComment(7, 'hi', 'uid-1'));
    expectChain(0, 'grant_comments', [
      ['insert', { grant_id: 7, comment: 'hi', user_id: 'uid-1' }],
    ]);
  });
});

describe('grants', () => {
  it('getGrant', async () => {
    await expectPassthrough(grants.getGrant(7));
    expectChain(0, 'grant_record', [['select', '*'], ['eq', 'id', 7], ['single']]);
  });

  it('getOwnGrant adds the owner filter', async () => {
    await expectPassthrough(grants.getOwnGrant(7, 'uid-1'));
    expectChain(0, 'grant_record', [
      ['select', '*'],
      ['eq', 'id', 7],
      ['eq', 'user_id', 'uid-1'],
      ['single'],
    ]);
  });

  it('listGrantsForUser', async () => {
    await expectPassthrough(grants.listGrantsForUser('uid-1'));
    expectChain(0, 'grant_record', [
      ['select', '*'],
      ['eq', 'user_id', 'uid-1'],
    ]);
  });

  it('listGrantStatsForUser — stat-card projection', async () => {
    await expectPassthrough(grants.listGrantStatsForUser('uid-1'));
    expectChain(0, 'grant_record', [
      ['select', 'id, status, grant_amount, disbursed_funds, total_spent'],
      ['eq', 'user_id', 'uid-1'],
    ]);
  });

  it('listRecentGrantsForUser defaults to limit 5', async () => {
    await expectPassthrough(grants.listRecentGrantsForUser('uid-1'));
    expectChain(0, 'grant_record', [
      ['select', '*'],
      ['eq', 'user_id', 'uid-1'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 5],
    ]);
  });

  it('listRecentGrantsForUser honors an explicit limit', async () => {
    await expectPassthrough(grants.listRecentGrantsForUser('uid-1', 3));
    expectChain(0, 'grant_record', [
      ['select', '*'],
      ['eq', 'user_id', 'uid-1'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 3],
    ]);
  });

  it('listGrantsForDashboard — owner-joined projection, no order', async () => {
    await expectPassthrough(grants.listGrantsForDashboard());
    expectChain(0, 'grant_record', [
      [
        'select',
        'id, grant_name, grant_amount, total_spent, status, created_at, user_id, users(firstname, lastname, organization_name)',
      ],
    ]);
  });

  it('insertGrant — payload IS array-wrapped, bare .select()', async () => {
    const grant = { grant_name: 'G' };
    await expectPassthrough(grants.insertGrant(grant));
    expectChain(0, 'grant_record', [['insert', [grant]], ['select']]);
  });

  it('listAllGrantsForAdmin — projection, newest first', async () => {
    await expectPassthrough(grants.listAllGrantsForAdmin());
    expectChain(0, 'grant_record', [
      [
        'select',
        'id, grant_name, grant_amount, status, created_at, end_spend_period, user_id, users(firstname, lastname, organization_name)',
      ],
      ['order', 'created_at', { ascending: false }],
    ]);
  });

  it('updateGrant — no trailing .select()', async () => {
    await expectPassthrough(grants.updateGrant(7, { status: 'approved' }));
    expectChain(0, 'grant_record', [
      ['update', { status: 'approved' }],
      ['eq', 'id', 7],
    ]);
  });

  it('updateOwnGrant scopes the update to the owner', async () => {
    await expectPassthrough(grants.updateOwnGrant(7, 'uid-1', { grant_name: 'X' }));
    expectChain(0, 'grant_record', [
      ['update', { grant_name: 'X' }],
      ['eq', 'id', 7],
      ['eq', 'user_id', 'uid-1'],
    ]);
  });
});

describe('inquiries', () => {
  it('acceptSponsorshipInquiry calls the RPC with a numeric id', async () => {
    const result = { data: { grant_id: 42 }, error: null };
    rpcMock.mockResolvedValue(result);
    await expect(inquiries.acceptSponsorshipInquiry('7')).resolves.toEqual(result);
    expect(rpcMock).toHaveBeenCalledWith('accept_sponsorship_inquiry', { p_inquiry_id: 7 });
  });

  it('acceptSponsorshipInquiry surfaces the RPC error untouched', async () => {
    const rpcError = { message: 'nope' };
    rpcMock.mockResolvedValue({ data: null, error: rpcError });
    const { error } = await inquiries.acceptSponsorshipInquiry(7);
    expect(error).toBe(rpcError);
  });

  it('updateInquiryStatus — Number id, returns the updated rows', async () => {
    const rows = await inquiries.updateInquiryStatus('3', 'declined');
    expect(rows).toEqual([{ id: 1 }]);
    expectChain(0, 'sponsorship_inquiries', [
      ['update', { status: 'declined' }],
      ['eq', 'id', 3],
      ['select'],
    ]);
  });

  it('updateInquiryStatus zero rows throws the exact RLS message', async () => {
    state.results.sponsorship_inquiries = { data: [], error: null };
    await expect(inquiries.updateInquiryStatus('3', 'declined')).rejects.toThrow(
      'Update was not applied — check RLS policies for sponsorship_inquiries.'
    );
  });

  it('updateInquiryStatus propagates the supabase error object as thrown', async () => {
    const boom = new Error('rls boom');
    state.results.sponsorship_inquiries = { data: null, error: boom };
    await expect(inquiries.updateInquiryStatus('3', 'reviewing')).rejects.toBe(boom);
  });

  it("insertInquiry — bare payload, .select('id').single()", async () => {
    const row = { listing_id: 1, project: 'p', contact: 'c', message: 'm' };
    await expectPassthrough(inquiries.insertInquiry(row));
    expectChain(0, 'sponsorship_inquiries', [
      ['insert', row],
      ['select', 'id'],
      ['single'],
    ]);
  });

  it('listInquiriesForListing — Number id, newest first', async () => {
    await expectPassthrough(inquiries.listInquiriesForListing('5'));
    expectChain(0, 'sponsorship_inquiries', [
      ['select', '*'],
      ['eq', 'listing_id', 5],
      ['order', 'submitted_at', { ascending: false }],
    ]);
  });
});

describe('notifications', () => {
  it('markNotificationRead', async () => {
    await expectPassthrough(notifications.markNotificationRead(3));
    expectChain(0, 'notifications', [
      ['update', { is_read: true }],
      ['eq', 'id', 3],
    ]);
  });

  it('markNotificationsRead', async () => {
    await expectPassthrough(notifications.markNotificationsRead([1, 2]));
    expectChain(0, 'notifications', [
      ['update', { is_read: true }],
      ['in', 'id', [1, 2]],
    ]);
  });

  it('deleteNotifications', async () => {
    await expectPassthrough(notifications.deleteNotifications([1, 2]));
    expectChain(0, 'notifications', [['delete'], ['in', 'id', [1, 2]]]);
  });
});

describe('receipts', () => {
  it('listReceiptsByGrant — expense/file projection', async () => {
    await expectPassthrough(receipts.listReceiptsByGrant(7));
    expectChain(0, 'receipts', [
      ['select', 'expense_id, receipt_files'],
      ['eq', 'grant_id', 7],
    ]);
  });

  it('deleteReceiptByExpense', async () => {
    await expectPassthrough(receipts.deleteReceiptByExpense(9));
    expectChain(0, 'receipts', [['delete'], ['eq', 'expense_id', 9]]);
  });

  it('insertReceipt — bare insert, no select', async () => {
    const row = { grant_id: 7, expense_id: 9 };
    await expectPassthrough(receipts.insertReceipt(row));
    expectChain(0, 'receipts', [['insert', row]]);
  });
});

describe('tenantMemberships', () => {
  it('getMyTenantMembership — active, newest first, maybeSingle, no tenant filter', async () => {
    await expectPassthrough(tenantMemberships.getMyTenantMembership());
    expectChain(0, 'tenant_memberships', [
      ['select', '*'],
      ['eq', 'is_active', true],
      ['order', 'updated_at', { ascending: false }],
      ['limit', 1],
      ['maybeSingle'],
    ]);
  });
});

describe('tenants', () => {
  it('listTenants — newest first', async () => {
    await expectPassthrough(tenants.listTenants());
    expectChain(0, 'tenants', [
      ['select', '*'],
      ['order', 'created_at', { ascending: false }],
    ]);
  });

  it('listAllUserTenantIds reads users', async () => {
    await expectPassthrough(tenants.listAllUserTenantIds());
    expectChain(0, 'users', [['select', 'tenant_id']]);
  });

  it('listAllTenantSettings', async () => {
    await expectPassthrough(tenants.listAllTenantSettings());
    expectChain(0, 'tenant_settings', [['select', '*']]);
  });

  it('createTenant — bare payload, .select().single()', async () => {
    const t = { name: 'T' };
    await expectPassthrough(tenants.createTenant(t));
    expectChain(0, 'tenants', [['insert', t], ['select'], ['single']]);
  });

  it('createTenantSettings — bare insert, no select', async () => {
    const s = { tenant_id: 2 };
    await expectPassthrough(tenants.createTenantSettings(s));
    expectChain(0, 'tenant_settings', [['insert', s]]);
  });

  it('createTenantAdminInvite writes to invites', async () => {
    const invite = { email: 'a@b.c' };
    await expectPassthrough(tenants.createTenantAdminInvite(invite));
    expectChain(0, 'invites', [['insert', invite], ['select'], ['single']]);
  });

  it('getPlatformSettings', async () => {
    await expectPassthrough(tenants.getPlatformSettings());
    expectChain(0, 'platform_settings', [['select', '*'], ['single']]);
  });

  it('updatePlatformSettings targets the singleton row id 1', async () => {
    await expectPassthrough(tenants.updatePlatformSettings({ platform_root_slug: 'x' }));
    expectChain(0, 'platform_settings', [
      ['update', { platform_root_slug: 'x' }],
      ['eq', 'id', 1],
    ]);
  });

  it('setTenantActive', async () => {
    await expectPassthrough(tenants.setTenantActive(2, false));
    expectChain(0, 'tenants', [
      ['update', { is_active: false }],
      ['eq', 'id', 2],
    ]);
  });

  it('updateTenantSettings keys on tenant_id', async () => {
    await expectPassthrough(tenants.updateTenantSettings(2, { support_email: 'x@y.z' }));
    expectChain(0, 'tenant_settings', [
      ['update', { support_email: 'x@y.z' }],
      ['eq', 'tenant_id', 2],
    ]);
  });

  it('setTenantRequireSubscription', async () => {
    await expectPassthrough(tenants.setTenantRequireSubscription(2, true));
    expectChain(0, 'tenant_settings', [
      ['update', { require_subscription: true }],
      ['eq', 'tenant_id', 2],
    ]);
  });

  it('listTenantUserIds reads users', async () => {
    await expectPassthrough(tenants.listTenantUserIds(2));
    expectChain(0, 'users', [
      ['select', 'id'],
      ['eq', 'tenant_id', 2],
    ]);
  });

  it('deleteManualMembershipsForUsers — manual source only, user set', async () => {
    await expectPassthrough(tenants.deleteManualMembershipsForUsers([1, 2]));
    expectChain(0, 'user_memberships', [
      ['delete'],
      ['eq', 'source', 'manual'],
      ['in', 'user_id', [1, 2]],
    ]);
  });
});

describe('users', () => {
  it('getUserByAuthId keys on user_id (auth id), single', async () => {
    await expectPassthrough(users.getUserByAuthId('auth-1'));
    expectChain(0, 'users', [
      ['select', '*'],
      ['eq', 'user_id', 'auth-1'],
      ['single'],
    ]);
  });

  it('listAuditUsers — name/role projection', async () => {
    await expectPassthrough(users.listAuditUsers());
    expectChain(0, 'users', [['select', 'user_id, firstname, lastname, role']]);
  });

  it('listTenantUsers — admin-list projection, newest first', async () => {
    await expectPassthrough(users.listTenantUsers());
    expectChain(0, 'users', [
      [
        'select',
        'id, firstname, lastname, email, organization_name, phone_number, role, user_id, is_active, created_at',
      ],
      ['order', 'created_at', { ascending: false }],
    ]);
  });

  it('listActiveMemberships', async () => {
    await expectPassthrough(users.listActiveMemberships());
    expectChain(0, 'user_memberships', [
      ['select', '*'],
      ['eq', 'is_active', true],
    ]);
  });

  it('updateUser — no trailing .select()', async () => {
    await expectPassthrough(users.updateUser(3, { role: 'admin' }));
    expectChain(0, 'users', [
      ['update', { role: 'admin' }],
      ['eq', 'id', 3],
    ]);
  });

  it('waiveUserSubscription — manual upsert keyed on user_id', async () => {
    await expectPassthrough(users.waiveUserSubscription(3, 'basic'));
    expectChain(0, 'user_memberships', [
      [
        'upsert',
        { user_id: 3, membership_tier: 'basic', is_active: true, source: 'manual' },
        { onConflict: 'user_id' },
      ],
      ['select'],
      ['single'],
    ]);
  });

  it('removeUserMembership', async () => {
    await expectPassthrough(users.removeUserMembership(3));
    expectChain(0, 'user_memberships', [['delete'], ['eq', 'user_id', 3]]);
  });

  it('createUserInvite writes to invites', async () => {
    const invite = { email: 'a@b.c' };
    await expectPassthrough(users.createUserInvite(invite));
    expectChain(0, 'invites', [['insert', invite], ['select'], ['single']]);
  });
});
