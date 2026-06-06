"use client";

import { SessionProvider } from "next-auth/react";

import { UserDataAutoProvider } from "@/context/UserDataContext";

export default function AuthSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <UserDataAutoProvider>{children}</UserDataAutoProvider>
    </SessionProvider>
  );
}
