"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import Link from "next/link";
import ActionButton from "@/components/ui/ActionButton";
import EmptyState from "@/components/ui/EmptyState";
export default function TitleError() {
    return (<section className="px-4 py-10 sm:px-6 md:px-10">
      <EmptyState kicker="Erro ao carregar" title={uiMessage("ui.66b03983c7d7")} description={uiMessage("ui.9a33cb3df328")} accent="rose" action={<Link href="/buscar">
            <ActionButton variant="primary">{uiMessage("ui.8f1a85bb1fef")}</ActionButton>
          </Link>}/>
    </section>);
}

