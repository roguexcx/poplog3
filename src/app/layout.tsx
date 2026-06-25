import { uiMessage } from "@/lib/i18n/ui-message";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Sidebar from "@/components/layout/Sidebar";
import GlobalSearchHeader from "@/components/layout/GlobalSearchHeader";
import AgendaBackgroundRefresh from "@/components/layout/AgendaBackgroundRefresh";
import RadarBackgroundPrefetch from "@/components/layout/RadarBackgroundPrefetch";
import LocaleFooterSwitch from "@/components/layout/LocaleFooterSwitch";
import SiteFooter from "@/components/layout/SiteFooter";
import ConsentBanner from "@/components/legal/ConsentBanner";
import AuthSessionProvider from "@/components/auth/AuthSessionProvider";
import AdSenseBootstrap from "@/components/ads/AdSenseBootstrap";
import { FEATURES } from "@/lib/features";
import { normalizeInterfaceLanguage } from "@/server/source-engine/locale";
import "./globals.css";
export const metadata: Metadata = {
    title: {
        default: "POPLOG",
        template: "POPLOG — %s",
    },
    description: uiMessage("ui.81f21ae2a76d"),
};
export default async function RootLayout({ children, }: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const interfaceLanguage = normalizeInterfaceLanguage(cookieStore.get("poplog_interface_language")?.value);
    return (<html lang={interfaceLanguage} className="dark antialiased">
      <body>
        <AuthSessionProvider>
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
          <LocaleFooterSwitch />
          <ConsentBanner />
        </AuthSessionProvider>
      </body>
    </html>);
}

