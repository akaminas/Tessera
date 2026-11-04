import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { qk, queryClient } from '@/data/queryClient';
import type { Profile } from '@/data/types';
import { appUrl } from '@/lib/env';
import { applyUiPrefs } from '@/lib/prefs';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }>;
  sendMagicLink(email: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    sb()
      .auth.getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setLoading(false);
      });
    const { data: sub } = sb().auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') queryClient.clear();
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: qk.profile,
    enabled: Boolean(userId),
    queryFn: async () => must(await sb().from('profiles').select('*').eq('id', userId!).single()) as Profile,
  });

  useEffect(() => {
    const prefs = profileQuery.data?.preferences;
    if (prefs) applyUiPrefs({ theme: prefs.theme, density: prefs.density, motion: prefs.motion });
  }, [profileQuery.data?.preferences]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile: profileQuery.data ?? null,
      loading: loading || (Boolean(userId) && profileQuery.isLoading),
      async signIn(email, password) {
        const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      },
      async signUp(email, password, displayName) {
        const { data, error } = await sb().auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() }, emailRedirectTo: appUrl('auth/callback') },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },
      async sendMagicLink(email) {
        const { error } = await sb().auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: appUrl('auth/callback'), shouldCreateUser: false },
        });
        if (error) throw error;
      },
      async sendPasswordReset(email) {
        const { error } = await sb().auth.resetPasswordForEmail(email.trim(), {
          redirectTo: appUrl('auth/reset'),
        });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await sb().auth.updateUser({ password });
        if (error) throw error;
      },
      async signOut() {
        await sb().auth.signOut();
      },
    }),
    [session, profileQuery.data, profileQuery.isLoading, loading, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Current user id; only call inside authenticated routes. */
export function useUserId(): string {
  const { user } = useAuth();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}
