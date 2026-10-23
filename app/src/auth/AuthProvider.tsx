import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepAlive } from '../lib/keepAlive';
import { supabase } from '../lib/supabase';
import { AuthContext, type AuthState, type CustomerRow } from './AuthContext';

type Loaded = { userId: string; customer: CustomerRow | null; failed: boolean };

// Session comes from Supabase Auth; the customers row (and with it the role) from the database.
// RLS lets a customer read only their own row and the trainer read all, so the row is selected
// by auth_user_id.
export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined: the stored session has not been read yet.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const latestLoad = useRef(0);
  const keptAliveFor = useRef<string | null>(null);
  // The signed-in user as of the latest auth event, so refresh() stays correct for callers that
  // captured it before the user signed in (the invite page signs up, then refreshes).
  const currentUserId = useRef<string | null>(null);

  useEffect(() => {
    // Only store the session here; calling Supabase from inside this callback can deadlock.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      currentUserId.current = next?.user.id ?? null;
      setSession(next);
      if (next === null) setLoaded(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const loadCustomer = useCallback(async (id: string) => {
    const load = ++latestLoad.current;
    let result: Loaded;
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('auth_user_id', id)
        .maybeSingle();
      if (error) console.warn('customer lookup failed', error.message);
      // A failed lookup is not "no customer row": it must not look like an unlinked account.
      result = { userId: id, customer: data ?? null, failed: error !== null };
    } catch (error) {
      console.warn('customer lookup failed', error);
      result = { userId: id, customer: null, failed: true };
    }
    // A newer load (for example the refresh after accept_invite) wins over a slower older one.
    if (load === latestLoad.current) setLoaded(result);
  }, []);

  useEffect(() => {
    if (userId === null) return;
    void loadCustomer(userId);
  }, [userId, loadCustomer]);

  useEffect(() => {
    // Once per signed-in user, not on every token refresh.
    if (userId === null || keptAliveFor.current === userId) return;
    keptAliveFor.current = userId;
    void keepAlive(supabase);
  }, [userId]);

  const refresh = useCallback(async () => {
    if (currentUserId.current !== null) await loadCustomer(currentUserId.current);
  }, [loadCustomer]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.warn('sign out failed', error.message);
  }, []);

  const value = useMemo<AuthState>(() => {
    const customer = loaded !== null && loaded.userId === userId ? loaded.customer : null;
    const customerKnown = userId === null || (loaded !== null && loaded.userId === userId);
    return {
      loading: session === undefined || !customerKnown,
      session: session ?? null,
      customer,
      lookupFailed: loaded !== null && loaded.userId === userId && loaded.failed,
      role: customer?.role ?? null,
      refresh,
      signOut,
    };
  }, [session, userId, loaded, refresh, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
