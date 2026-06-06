import type { Metadata } from "next";
import PageShell from "@/components/layout/PageShell";
import ForYouAllPage from "@/features/for-you/ForYouAllPage";
import { UserDataAutoProvider } from "@/context/UserDataContext";

export const metadata: Metadata = {
  title: "Para você",
  description: "Recomendações personalizadas com base na sua biblioteca.",
};

export default function ParaVocePage() {
  return (
    <PageShell variant="wide">
      <UserDataAutoProvider>
        <ForYouAllPage />
      </UserDataAutoProvider>
    </PageShell>
  );
}
