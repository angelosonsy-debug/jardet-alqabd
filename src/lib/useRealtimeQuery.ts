import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

/**
 * Runs a Supabase query and keeps the result fresh by re-running it whenever
 * Postgres Changes fires for the given table (optionally filtered). This is
 * intentionally "refetch on change" rather than hand-patching local state —
 * simpler to reason about, and correct by construction since the database is
 * always the source of truth (never trust an optimistic local merge for money).
 */
export function useRealtimeQuery<T>(
  table: string,
  queryBuilder: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  filter?: string,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    const { data: rows, error: err } = await queryBuilder();
    if (err) setError(err.message);
    else {
      setData(rows ?? []);
      setError(null);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setLoading(true);
    run();

    const channel = supabase
      .channel(`${table}_${filter ?? 'all'}_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => run(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, run]);

  return { data, loading, error, refresh: run };
}
