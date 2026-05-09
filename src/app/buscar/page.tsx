import type { Metadata } from "next";
import { Suspense } from "react";
import BuscarClient from "./BuscarClient";

export const metadata: Metadata = {
  title: "Buscar — POPLOG",
  description: "Busque filmes e séries no Poplog.",
};

export default function BuscarPage() {
  return (
    <Suspense fallback={null}>
      <BuscarClient />
    </Suspense>
  );
}
