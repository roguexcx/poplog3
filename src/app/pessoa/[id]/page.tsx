import { redirect } from "next/navigation";

/**
 * Rota legada (era TMDB). A página canônica de pessoa é /person/[id],
 * servida por getPersonPageData + cache local. Mantida apenas como redirect
 * permanente para não quebrar bookmarks/links antigos.
 */
type PessoaLegacyPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PessoaLegacyPage({ params }: PessoaLegacyPageProps) {
  const { id } = await params;
  redirect(`/person/${id}`);
}
