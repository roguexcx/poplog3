import { uiMessage } from "@/lib/i18n/ui-message";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
type CleanPageProps = {
    eyebrow: string;
    title: string;
    description?: string;
};
/**
 * CleanPage — wrapper de transicao enquanto rotas ainda nao tem tela propria.
 * Usa os primitivos do design system para manter coerencia com Library,
 * Acompanhando e Title Page.
 */
export default function CleanPage({ eyebrow, title, description, }: CleanPageProps) {
    return (<section className="flex flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8 md:px-8 lg:px-10">
      <PageHeader variant="hero" eyebrow={eyebrow} title={title} description={description} accent="indigo"/>

      <EmptyState kicker="Em construcao" title={uiMessage("ui.26e736e80dca")} description={uiMessage("ui.b1e36b618993")} accent="neutral"/>
    </section>);
}

