import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acompanhando",
};

export default function AcompanhandoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
