"use client";
import { SessionProvider } from "next-auth/react";

import { LocaleProvider, type PoplogLocale } from "@/context/LocaleContext";
import { UserDataAutoProvider } from "@/context/UserDataContext";

export default function AuthSessionProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Partial<PoplogLocale> | null;
}) {
  return (
    <SessionProvider>
      <LocaleProvider initialLocale={initialLocale}>
        <UserDataAutoProvider>{children}</UserDataAutoProvider>
      </LocaleProvider>
    </SessionProvider>
  );
}
