// Pure grant-list filtering + sorting used by the grantee Grants view.
//
// Extracted from Grants.js so the search / status-filter / sort behavior can be
// unit-tested directly (frontend/src/utils/grantsList.test.js) instead of being
// asserted through a slow, brittle Playwright walkthrough.

// Apply the status tab, the expired-toggle, the keyword search, and the sort —
// returning a new array. `now` is injectable so the expired filter is testable.
export function filterSortGrants(
  grants,
  { filter = "all", searchTerm = "", sortBy = "start_spend_period", hideExpired = false, now = new Date() } = {}
) {
  // Filter by status tab and the expired toggle.
  const filtered = grants.filter((grant) => {
    if (filter !== "all" && grant.status?.toLowerCase() !== filter) return false;
    if (hideExpired && grant.end_spend_period && new Date(grant.end_spend_period + "T23:59:59") < now) return false;
    return true;
  });

  // Search by grant name, status, or amount.
  const searched = filtered.filter(
    (grant) =>
      (grant.grant_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      grant.status?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(grant.grant_amount).includes(searchTerm)
  );

  // Sort: amount descending, status alphabetical, else newest spend period first.
  return [...searched].sort((a, b) => {
    if (sortBy === "grant_amount") {
      return b.grant_amount - a.grant_amount;
    } else if (sortBy === "status") {
      return a.status.localeCompare(b.status);
    } else {
      return new Date(b.start_spend_period) - new Date(a.start_spend_period);
    }
  });
}
