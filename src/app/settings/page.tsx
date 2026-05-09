import type { Metadata } from "next";
import { Suspense } from "react";
import SettingsClient from "./SettingsClient";

export const metadata: Metadata = {
  title: "Configurações — POPLOG",
  description: "Gerencie sua conta no POPLOG.",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsClient />
    </Suspense>
  );
}
