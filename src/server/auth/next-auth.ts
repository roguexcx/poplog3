import NextAuth from "next-auth";

import { authOptions } from "@/server/auth/auth-options";

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
