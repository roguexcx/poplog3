import type { Metadata } from "next";
import GlobalAttributionFooter from "@/components/attribution/GlobalAttributionFooter";
import Sidebar from "@/components/layout/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "POPLOG",
  description:
    "Descubra, organize e acompanhe filmes e séries em uma experiência pessoal.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark antialiased">
      <body>
        <Sidebar />

        <main className="relative min-h-dvh transition-[margin] duration-300 ease-in-out md:ml-20 md:peer-hover/sidebar:ml-64">
          <div className="min-h-dvh px-4 pb-24 pt-4 sm:px-6 md:px-8 md:pb-8 md:pt-6 lg:px-10">
            {children}
            <GlobalAttributionFooter />
          </div>
        </main>
      </body>
    </html>
  );
}
