import { setServerUiMessageLanguage, uiMessageFor } from "@/lib/i18n/ui-message";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Sidebar from "@/components/layout/Sidebar";
import GlobalSearchHeader from "@/components/layout/GlobalSearchHeader";
import AgendaBackgroundRefresh from "@/components/layout/AgendaBackgroundRefresh";
import RadarBackgroundPrefetch from "@/components/layout/RadarBackgroundPrefetch";
import SiteFooter from "@/components/layout/SiteFooter";
import ConsentBanner from "@/components/legal/ConsentBanner";
import AuthSessionProvider from "@/components/auth/AuthSessionProvider";
import AdSenseBootstrap from "@/components/ads/AdSenseBootstrap";
import { FEATURES } from "@/lib/features";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
  normalizeInterfaceLanguage,
} from "@/server/source-engine/locale";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
    const cookieStore = await cookies();
    const interfaceLanguage = normalizeInterfaceLanguage(cookieStore.get("poplog_interface_language")?.value);
    return {
    title: {
        default: "POPLOG",
        template: "POPLOG — %s",
    },
        description: uiMessageFor(interfaceLanguage, "ui.81f21ae2a76d"),
    };
}
export default async function RootLayout({ children, }: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const initialLocale = {
        interfaceLanguage: normalizeInterfaceLanguage(cookieStore.get("poplog_interface_language")?.value) as "pt-BR" | "en-US",
        catalogLanguage: normalizeCatalogLanguage(cookieStore.get("poplog_catalog_language")?.value) as "pt-BR" | "en-US",
        region: normalizeCatalogRegion(cookieStore.get("poplog_region")?.value) as "BR" | "US",
    };
    setServerUiMessageLanguage(initialLocale.interfaceLanguage);
    return (<html lang={initialLocale.interfaceLanguage} data-interface-language={initialLocale.interfaceLanguage} data-catalog-language={initialLocale.catalogLanguage} data-region={initialLocale.region} className="dark antialiased">
      <body>
        <AuthSessionProvider initialLocale={initialLocale}>
          <AdSenseBootstrap />
          <Sidebar />
          <AgendaBackgroundRefresh />
          {FEATURES.RADAR && <RadarBackgroundPrefetch />}
          <main className="relative min-h-dvh transition-[margin] duration-300 ease-in-out md:ml-20 md:peer-hover/sidebar:ml-64">
            <div className="min-h-dvh px-4 pb-24 pt-4 sm:px-6 md:px-8 md:pb-8 md:pt-6 lg:px-10">
              <GlobalSearchHeader />
              {children}
              <SiteFooter />
            </div>
          </main>
          <ConsentBanner />
        </AuthSessionProvider>
      </body>
    </html>);
}
