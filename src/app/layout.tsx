import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "Poplog",
  description: "Sua curadoria pessoal de filmes e séries.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark antialiased">
      <body className="min-h-screen bg-[#080810] text-zinc-100 selection:bg-indigo-500/30">
        <Sidebar />

        <main className="min-h-screen transition-[margin] duration-300 ease-in-out md:ml-20 md:peer-hover/sidebar:ml-60">
          <div className="layout-content pb-24 md:pb-0">{children}</div>
        </main>
      </body>
    </html>
  );
}
