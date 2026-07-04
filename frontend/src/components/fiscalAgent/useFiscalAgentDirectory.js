import { useEffect, useMemo, useState } from 'react';
import * as Sentry from '@sentry/react';
import { listPublishedListings, listPublicListings } from '../../lib/data/fiscalAgentListings';
import { canViewDirectory } from '../../lib/policy';
import { mapTeaserListing, mapFullListing } from './fiscalAgents.map';
import { PAGE_SIZE } from './fiscalAgentsShared';

/**
 * Data + filter/derivation state for the Fiscal Agent Directory. Owns the
 * listing fetch (teaser vs full per entitlement), the filter/sort/pagination
 * state, and all derived views. UI-only state (saved, modals, toast, checkout)
 * stays in the component.
 *
 * @param {Object} session
 */
export function useFiscalAgentDirectory(session) {
  const subscribed = canViewDirectory(session);

  const [query, setQuery] = useState('');
  const [activeFocus, setActiveFocus] = useState('All');
  const [region, setRegion] = useState('All');
  const [acceptingOnly, setAcceptingOnly] = useState(false);
  const [sort, setSort] = useState('rating');
  const [page, setPage] = useState(1);

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Fetch listings. Always read the public teaser view; when entitled, read the
  // full table too (RLS returns full rows only to subscribers/owners/super
  // admins). Subscribed sessions render full rows; locked sessions only ever
  // hold teaser data so contact info is never fetched client-side.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        if (subscribed) {
          const { data, error } = await listPublishedListings();
          if (error) throw error;
          if (!cancelled) setAgents((data || []).map(mapFullListing));
        } else {
          const { data, error } = await listPublicListings();
          if (error) throw error;
          if (!cancelled) setAgents((data || []).map(mapTeaserListing));
        }
      } catch (err) {
        Sentry.captureException(err);
        if (!cancelled) {
          setLoadError(true);
          setAgents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [subscribed]);

  const regions = useMemo(
    () => ['All', ...Array.from(new Set(agents.map((a) => a.region).filter(Boolean)))],
    [agents],
  );

  // Reset pagination whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [query, activeFocus, region, acceptingOnly, sort]);

  const filtered = useMemo(() => {
    const list = agents.filter((a) => {
      const matchesQuery =
        !query ||
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.location.toLowerCase().includes(query.toLowerCase());
      const matchesFocus = activeFocus === 'All' || (a.focus || []).includes(activeFocus);
      const matchesRegion = region === 'All' || a.region === region;
      const matchesAccepting = !acceptingOnly || a.accepting;
      return matchesQuery && matchesFocus && matchesRegion && matchesAccepting;
    });

    const sorted = [...list].sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'sponsored') return b.sponsored - a.sponsored;
      if (sort === 'feeLow') return a.feeNum - b.feeNum;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [agents, query, activeFocus, region, acceptingOnly, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const heroStats = useMemo(
    () => ({
      total: agents.length,
      verified: agents.filter((a) => a.verified).length,
      sponsored: agents.reduce((n, a) => n + (a.sponsored || 0), 0),
    }),
    [agents],
  );

  function clearFilters() {
    setQuery('');
    setActiveFocus('All');
    setRegion('All');
    setAcceptingOnly(false);
    setSort('rating');
  }

  const hasFilters =
    query || activeFocus !== 'All' || region !== 'All' || acceptingOnly || sort !== 'rating';

  return {
    subscribed,
    agents,
    loading,
    loadError,
    regions,
    filtered,
    visible,
    pageCount,
    heroStats,
    hasFilters,
    clearFilters,
    query, setQuery,
    activeFocus, setActiveFocus,
    region, setRegion,
    acceptingOnly, setAcceptingOnly,
    sort, setSort,
    page, setPage,
  };
}
