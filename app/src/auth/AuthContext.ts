import type { Session } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';
import type { Tables } from '../lib/database.types';

export type CustomerRow = Tables<'customers'>;
export type Role = CustomerRow['role'];

export type AuthState = {
  loading: boolean;
  session: Session | null;
  customer: CustomerRow | null;
  lookupFailed: boolean;
  role: Role | null;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useCustomer(): CustomerRow {
  const { customer } = useAuth();
  if (customer === null) throw new Error('useCustomer must be used below RequireAuth');
  return customer;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
