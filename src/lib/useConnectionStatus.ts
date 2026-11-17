import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

/**
 * Tracks both browser connectivity AND the Supabase Realtime socket state.
 * Financial actions (register/revert payment, cash edits) must be disabled
 * whenever this is not 'online' — the spec explicitly forbids claiming an
 * operation succeeded while it cannot be safely synced.
 */
export function useConnectionStatus(): ConnectionStatus {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [socketState, setSocketState] = useState<string>('closed');

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const interval = setInterval(() => {
      const state: string = supabase.realtime?.connectionState?.() ?? 'closed';
      setSocketState(state);
    }, 2000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  if (!browserOnline) return 'offline';
  if (socketState === 'open') return 'online';
  if (socketState === 'connecting') return 'reconnecting';
  return 'reconnecting';
}
