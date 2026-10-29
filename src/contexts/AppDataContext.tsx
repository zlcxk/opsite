import { createContext, useContext, type ReactNode } from 'react';
import type { DashboardData } from '@shared/types';
import { useApi } from '../lib/hooks';

interface AppDataValue {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, refetch } = useApi<DashboardData>('/dashboard', 30_000);
  return (
    <AppDataContext.Provider value={{ data, loading, error, refresh: refetch }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataValue {
  const context = useContext(AppDataContext);
  if (!context) throw new Error('useAppData must be used inside AppDataProvider');
  return context;
}
