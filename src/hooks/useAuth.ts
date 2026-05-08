"use client";

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isLoggedIn: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    isLoggedIn: false,
  });

  useEffect(() => {
    const supabase = createClient();

    // onAuthStateChange dispara imediatamente com INITIAL_SESSION,
    // eliminando a race condition com getSession().
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
        isLoggedIn: !!session?.user,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}