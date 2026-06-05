import SearchPageView from "@/features/search/SearchPageView";

type BuscarPageProps = {
  searchParams?: Promise<{
    q?: string;
    type?: string;
    page?: string;
    atalho?: string;
  }>;
};

export default async function BuscarPage({
  searchParams,
}: BuscarPageProps) {
  const params = await searchParams;

  const query = params?.q?.trim() ?? "";
  const type = params?.type ?? "all";
  const page = Number(params?.page ?? "1");
  const shortcut = params?.atalho?.trim() ?? "";

  return (
    <SearchPageView
      initialQuery={query}
      initialType={type}
      initialPage={page}
      initialShortcut={shortcut}
    />
  );
}