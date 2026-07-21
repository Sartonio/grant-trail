import { describe, test, expect } from 'vitest';
import { computeGrantInsights } from './grantInsights';

describe('computeGrantInsights', () => {
  test('empty input yields zeroed overall, empty year/source arrays, null success rate', () => {
    const result = computeGrantInsights([]);
    expect(result.overall).toEqual({
      total: 0,
      pending: 0,
      approved: 0,
      declined: 0,
      needsChanges: 0,
      requested: 0,
      awarded: 0,
      disbursed: 0,
      successRate: null,
    });
    expect(result.byYear).toEqual([]);
    expect(result.bySource).toEqual([]);
  });

  test('undefined argument is tolerated', () => {
    const result = computeGrantInsights();
    expect(result.overall.total).toBe(0);
    expect(result.byYear).toEqual([]);
  });

  test('multi-year mix across all statuses aggregates overall and per-year', () => {
    const grants = [
      // 2022
      { status: 'approved', grant_amount: 1000, disbursed_funds: 800, funding_source: 'Alpha', submitted_at: '2022-03-01T00:00:00Z' },
      { status: 'declined', grant_amount: 500, disbursed_funds: 0, funding_source: 'Beta', submitted_at: '2022-06-01T00:00:00Z' },
      // 2023
      { status: 'pending', grant_amount: 2000, disbursed_funds: 0, funding_source: 'Alpha', submitted_at: '2023-01-15T00:00:00Z' },
      { status: 'needs_changes', grant_amount: 300, disbursed_funds: 0, funding_source: 'Alpha', submitted_at: '2023-05-01T00:00:00Z' },
      { status: 'approved', grant_amount: 4000, disbursed_funds: 4000, funding_source: 'Beta', submitted_at: '2023-09-01T00:00:00Z' },
    ];
    const { overall, byYear } = computeGrantInsights(grants);

    expect(overall.total).toBe(5);
    expect(overall.pending).toBe(1);
    expect(overall.approved).toBe(2);
    expect(overall.declined).toBe(1);
    expect(overall.needsChanges).toBe(1);
    expect(overall.requested).toBe(1000 + 500 + 2000 + 300 + 4000);
    expect(overall.awarded).toBe(1000 + 4000);
    expect(overall.disbursed).toBe(800 + 4000);
    // approved / (approved + declined) = 2 / 3
    expect(overall.successRate).toBeCloseTo(2 / 3);

    expect(byYear.map((y) => y.year)).toEqual([2022, 2023]);
    const y2022 = byYear[0];
    expect(y2022).toMatchObject({
      submitted: 2,
      approved: 1,
      declined: 1,
      pending: 0,
      needsChanges: 0,
      requested: 1500,
      awarded: 1000,
    });
    expect(y2022.successRate).toBeCloseTo(1 / 2);
    const y2023 = byYear[1];
    expect(y2023).toMatchObject({
      submitted: 3,
      approved: 1,
      declined: 0,
      pending: 1,
      needsChanges: 1,
      requested: 6300,
      awarded: 4000,
    });
    // no declined in 2023 -> approved / (approved + declined) = 1/1
    expect(y2023.successRate).toBe(1);
  });

  test('null/undefined amounts treated as 0', () => {
    const grants = [
      { status: 'approved', grant_amount: null, disbursed_funds: undefined, funding_source: 'Alpha', submitted_at: '2024-01-01T00:00:00Z' },
      { status: 'approved', grant_amount: 250, funding_source: 'Alpha', submitted_at: '2024-02-01T00:00:00Z' },
    ];
    const { overall, bySource } = computeGrantInsights(grants);
    expect(overall.requested).toBe(250);
    expect(overall.awarded).toBe(250);
    expect(overall.disbursed).toBe(0);
    expect(bySource[0]).toMatchObject({ source: 'Alpha', count: 2, requested: 250, awarded: 250 });
  });

  test('rows missing both dates are skipped in byYear but still counted in overall/bySource', () => {
    const grants = [
      { status: 'approved', grant_amount: 100, funding_source: 'Alpha' }, // no dates
      { status: 'approved', grant_amount: 200, funding_source: 'Alpha', submitted_at: '2025-01-01T00:00:00Z' },
    ];
    const { overall, byYear } = computeGrantInsights(grants);
    expect(overall.total).toBe(2);
    expect(overall.requested).toBe(300);
    expect(byYear).toHaveLength(1);
    expect(byYear[0].year).toBe(2025);
    expect(byYear[0].requested).toBe(200);
  });

  test('created_at is used as the year fallback when submitted_at is absent', () => {
    const grants = [
      { status: 'pending', grant_amount: 10, created_at: '2021-12-15T00:00:00Z' },
    ];
    const { byYear } = computeGrantInsights(grants);
    expect(byYear[0].year).toBe(2021);
  });

  test('year extraction is UTC-stable regardless of local timezone', () => {
    // 2023-01-01T00:00:00Z is still 2023 in UTC even from a negative-offset zone.
    const grants = [{ status: 'pending', grant_amount: 1, submitted_at: '2023-01-01T00:00:00Z' }];
    expect(computeGrantInsights(grants).byYear[0].year).toBe(2023);
  });

  test('successRate is null when there are no decided (approved/declined) applications', () => {
    const grants = [
      { status: 'pending', grant_amount: 100, submitted_at: '2023-01-01T00:00:00Z' },
      { status: 'needs_changes', grant_amount: 200, submitted_at: '2023-02-01T00:00:00Z' },
    ];
    const { overall, byYear } = computeGrantInsights(grants);
    expect(overall.successRate).toBeNull();
    expect(byYear[0].successRate).toBeNull();
  });

  test('funding sources: null/empty grouped under Unspecified and sorted by requested desc', () => {
    const grants = [
      { status: 'approved', grant_amount: 100, funding_source: 'Small', submitted_at: '2023-01-01T00:00:00Z' },
      { status: 'declined', grant_amount: 5000, funding_source: 'Large', submitted_at: '2023-01-01T00:00:00Z' },
      { status: 'pending', grant_amount: 900, funding_source: null, submitted_at: '2023-01-01T00:00:00Z' },
      { status: 'pending', grant_amount: 100, funding_source: '   ', submitted_at: '2023-01-01T00:00:00Z' },
    ];
    const { bySource } = computeGrantInsights(grants);
    expect(bySource.map((s) => s.source)).toEqual(['Large', 'Unspecified', 'Small']);
    const unspecified = bySource.find((s) => s.source === 'Unspecified');
    expect(unspecified).toMatchObject({ count: 2, requested: 1000, awarded: 0 });
    const large = bySource.find((s) => s.source === 'Large');
    expect(large).toMatchObject({ count: 1, requested: 5000, awarded: 0 });
  });
});
