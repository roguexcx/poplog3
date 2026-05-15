import type { ReactNode } from "react";

type PageShellVariant = "wide" | "cinematic" | "centered";

type PageShellProps = {
  children: ReactNode;
  variant?: PageShellVariant;
  className?: string;
};

const VARIANT_STYLES: Record<PageShellVariant, string> = {
  wide:
    "mx-auto w-full max-w-[1600px] px-4 sm:px-6 md:px-8 lg:px-10",

  cinematic:
    "mx-auto w-full max-w-[1800px] px-0 sm:px-0 md:px-4 lg:px-8",

  centered:
    "mx-auto w-full max-w-[920px] px-4 sm:px-6 md:px-8",
};

export default function PageShell({
  children,
  variant = "wide",
  className = "",
}: PageShellProps) {
  return (
    <div
      className={[
        VARIANT_STYLES[variant],
        "pb-24 md:pb-10",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}