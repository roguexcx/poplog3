// src/hooks/useUserTitles.ts
"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { getUserTitles } from "@/lib/user-title-service";
import type { UserTitle } from "@/types/user";

export function useUserTitles() {
  const { user, loading: userLoading } = useAuth();
  const [titles, setTitles] = useState<UserTitle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userLoading) return;

    if (!user) {
      setTitles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    getUserTitles(user.id)
      .then(setTitles)
      .finally(() => setLoading(false));
  }, [user, userLoading]);

  return { titles, loading };
}