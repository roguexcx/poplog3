import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Poplog",
  description: "Sua curadoria pessoal de filmes e séries.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} dark antialiased`}>
      <body className="min-h-screen bg-[#080810] text-zinc-100 selection:bg-indigo-500/30">
        <Sidebar />
        
        {/* O conteúdo principal agora tem uma transição suave.
            No desktop (md:), começa com 80px de margem. 
        */}
        <main className="min-h-screen transition-[margin] duration-300 ease-in-out md:ml-20 md:peer-hover/sidebar:ml-60">
  <div className="layout-content pb-24 md:pb-0">
    {children}
  </div>
</main>
      </body>
    </html>
  );
}