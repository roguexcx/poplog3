import { uiMessage } from "@/lib/i18n/ui-message";
import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import ForYouAllPage from "@/features/for-you/ForYouAllPage";
import { UserDataAutoProvider } from "@/context/UserDataContext";
export const metadata: Metadata = {
    title: uiMessage("ui.de4780f1e590"),
    description: uiMessage("ui.6a07e2d3a014"),
};
export default function ParaVocePage() {
    return (<PageShell variant="wide">
      <UserDataAutoProvider>
        <ForYouAllPage />
      </UserDataAutoProvider>
    </PageShell>);
}

