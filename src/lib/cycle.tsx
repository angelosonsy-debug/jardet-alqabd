import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabaseClient';
import type { PayrollCycle } from '../types/database';

interface CycleState {
  cycles: PayrollCycle[];
  activeCycle: PayrollCycle | null;
  setActiveCycleId: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CycleContext = createContext<CycleState | null>(null);

export function CycleProvider({ children }: { children: ReactNode }) {
  const [cycles, setCycles] = useState<PayrollCycle[]>([]);
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await supabase
      .from('payroll_cycles')
      .select('*')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });
    const list = (data ?? []) as PayrollCycle[];
    setCycles(list);
    setLoading(false);

    setActiveCycleId((current) => {
      if (current && list.some((c) => c.id === current)) return current;
      const firstOpen = list.find((c) => c.status === 'open');
      return firstOpen?.id ?? list[0]?.id ?? null;
    });
  };

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel('payroll_cycles_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_cycles' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeCycle = cycles.find((c) => c.id === activeCycleId) ?? null;

  return (
    <CycleContext.Provider value={{ cycles, activeCycle, setActiveCycleId, loading, refresh }}>
      {children}
    </CycleContext.Provider>
  );
}

export function useCycle(): CycleState {
  const ctx = useContext(CycleContext);
  if (!ctx) throw new Error('useCycle must be used within CycleProvider');
  return ctx;
}

export const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
