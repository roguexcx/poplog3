// src/features/home/SectionHeader.tsx

import type { ReactNode } from "react";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
};

export default function SectionHeader({
  title,
  subtitle,
  action,
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={[
        "mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between",
        className,
      ].join(" ")}
    >
      <div>
        <h2 className="text-2xl font-black tracking-tight text-white md:text-3xl">
          {title}
        </h2>

        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}