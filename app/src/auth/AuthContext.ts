import type { Session } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';
import type { Tables } from '../lib/database.types';

export type CustomerRow = Tables<'customers'>;
export type Role = CustomerRow['role'];

export type AuthState = {
  /** True until the stored session and the matching customers row are known. */
  loading: boolean;
  session: Session | null;
  /** The signed-in user's customers row; null for a user who is not linked to a customer. */
  customer: CustomerRow | null;
  role: Role | null;
  /** Reloads the customers row, e.g. after accept_invite linked the account. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
