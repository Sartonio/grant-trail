// @vitest-environment node
import { describe, test, expect } from 'vitest';
import { filterSortGrants } from './grantsList';

// These cases replace the grants-list search / status-tab / sort assertions that
// used to live in the slow grantee-walkthrough Playwright spec (§4).

const grants = [
  { grant_name: 'Alpha',  status: 'approved',      grant_amount: 1000, start_spend_period: '2025-01-01', end_spend_period: '2025-06-30' },
  { grant_name: 'Bravo',  status: 'pending',       grant_amount: 5000, start_spend_period: '2025-03-01', end_spend_period: '2030-12-31' },
  { grant_name: 'Zebra',  status: 'approved',      grant_amount: 9000, start_spend_period: '2025-02-01', end_spend_period: '2030-12-31' },
  { grant_name: 'Charlie',status: 'needs_changes', grant_amount: 3000, start_spend_period: '2025-04-01', end_spend_period: '2030-12-31' },
];

const names = (rows) => rows.map((g) => g.grant_name);

describe('filterSortGrants', () => {
  test('default sort is newest spend period first', () => {
    expect(names(filterSortGrants(grants))).toEqual(['Charlie', 'Bravo', 'Zebra', 'Alpha']);
  });

  test('status tab filters to a single status', () => {
    expect(names(filterSortGrants(grants, { filter: 'approved' })).sort())
      .toEqual(['Alpha', 'Zebra']);
    expect(names(filterSortGrants(grants, { filter: 'pending' }))).toEqual(['Bravo']);
  });

  test('search matches name, status, or amount', () => {
    expect(names(filterSortGrants(grants, { searchTerm: 'zeb' }))).toEqual(['Zebra']);
    expect(names(filterSortGrants(grants, { searchTerm: 'needs_changes' }))).toEqual(['Charlie']);
    expect(names(filterSortGrants(grants, { searchTerm: '5000' }))).toEqual(['Bravo']);
  });

  test('sort by amount is descending', () => {
    expect(names(filterSortGrants(grants, { sortBy: 'grant_amount' })))
      .toEqual(['Zebra', 'Bravo', 'Charlie', 'Alpha']);
  });

  test('sort by status is alphabetical', () => {
    expect(names(filterSortGrants(grants, { sortBy: 'status' })))
      .toEqual(['Alpha', 'Zebra', 'Charlie', 'Bravo']);
  });

  test('hideExpired drops grants whose spend period has ended (relative to now)', () => {
    const now = new Date('2025-08-01T00:00:00');
    // Alpha's end_spend_period (2025-06-30) is before `now` → dropped.
    expect(names(filterSortGrants(grants, { hideExpired: true, now })))
      .not.toContain('Alpha');
    // Without the toggle Alpha stays.
    expect(names(filterSortGrants(grants, { hideExpired: false, now })))
      .toContain('Alpha');
  });

  test('returns a new array (does not mutate input order)', () => {
    const input = [...grants];
    filterSortGrants(input, { sortBy: 'grant_amount' });
    expect(input).toEqual(grants); // original untouched
  });
});
