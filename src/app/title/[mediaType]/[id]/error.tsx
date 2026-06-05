"use client";

import Link from "next/link";
import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";

export default function TitleError() {
  return (
    <section className="px-4 py-10 sm:px-6 md:px-10">
      <EmptyState
        kicker="Erro ao carregar"
        title="Não conseguimos abrir este título."
        description="Ocorreu um erro inesperado. Tente novamente ou volte para a busca."
        accent="rose"
        action={
          <Link href="/buscar">
            <ActionButton variant="primary">Voltar pra busca</ActionButton>
          </Link>
        }
      />
    </section>
  );
}
