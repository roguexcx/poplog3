export type AuthProviderSource = "local" | "authjs";

export type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  role?: "user" | "admin" | "master" | null;
  accessStatus?: "active" | "blocked" | null;
  adminPermissions?: string[];
  created_at?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  authProvider?: AuthProviderSource;
};
