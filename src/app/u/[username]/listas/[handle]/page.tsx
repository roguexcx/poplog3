import { uiMessage } from "@/lib/i18n/ui-message";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import ListPageClient from "@/features/lists/ListPageClient";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getPrivateListByShortId } from "@/server/lists/list-service";
export const metadata: Metadata = {
    title: uiMessage("ui.d8c06af81a34"),
    robots: { index: false, follow: false },
};
type PageProps = {
    params: Promise<{
        username: string;
        handle: string;
    }>;
};
export default async function UserListPage({ params }: PageProps) {
    const { username, handle } = await params;
    if (handle.length < 9 || handle[7] !== "-")
        notFound();
    const shortId = handle.slice(0, 7);
    const requestedSlug = handle.slice(8);
    if (!/^[A-Za-z0-9]{7}$/.test(shortId) || !requestedSlug)
        notFound();
    const user = await getCurrentUser();
    if (!user)
        notFound();
    const detail = await getPrivateListByShortId({
        userId: user.id,
        username,
        shortId,
    });
    if (!detail)
        notFound();
    const canonicalPath = `/u/${encodeURIComponent(detail.list.ownerUsername)}/listas/${detail.list.shortId}-${detail.list.slug}`;
    if (username !== detail.list.ownerUsername || requestedSlug !== detail.list.slug) {
        permanentRedirect(canonicalPath);
    }
    return (<PageShell variant="wide">
      <ListPageClient initialDetail={detail}/>
    </PageShell>);
}

