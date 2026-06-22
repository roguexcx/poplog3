import Image from "next/image";

type ProviderBadgeProps = {
  name: string;
  logoUrl?: string | null;
  /** Tipo de disponibilidade. Influencia label e cor. */
  type?: "streaming" | "rent" | "buy" | "free" | "ads";
  size?: "sm" | "md" | "lg";
  className?: string;
};

const TYPE_LABEL: Record<NonNullable<ProviderBadgeProps["type"]>, string> = {
  streaming: "Streaming",
  rent: "Aluguel",
  buy: "Compra",
  free: "Grátis",
  ads: "Com anúncios",
};

const TYPE_ACCENT: Record<NonNullable<ProviderBadgeProps["type"]>, string> = {
  streaming: "text-cyan-200/80",
  rent: "text-amber-200/80",
  buy: "text-fuchsia-200/80",
  free: "text-emerald-200/80",
  ads: "text-white/55",
};

const SIZE_LOGO: Record<NonNullable<ProviderBadgeProps["size"]>, number> = {
  sm: 28,
  md: 36,
  lg: 48,
};

const SIZE_GAP: Record<NonNullable<ProviderBadgeProps["size"]>, string> = {
  sm: "gap-2 p-2",
  md: "gap-3 p-3",
  lg: "gap-3.5 p-3.5",
};

const SIZE_TEXT: Record<NonNullable<ProviderBadgeProps["size"]>, string> = {
  sm: "text-[12px]",
  md: "text-[13px]",
  lg: "text-sm",
};

export default function ProviderBadge({
  name,
  logoUrl,
  type = "streaming",
  size = "md",
  className = "",
}: ProviderBadgeProps) {
  const logoSize = SIZE_LOGO[size];

  return (
    <div
      className={`inline-flex items-center rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-md transition duration-200 hover:border-white/[0.16] hover:bg-white/[0.07] ${SIZE_GAP[size]} ${className}`}
    >
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={name}
          width={logoSize}
          height={logoSize}
          unoptimized
          className="rounded-lg"
        />
      ) : (
        <div
          className="rounded-lg bg-white/10"
          style={{ width: logoSize, height: logoSize }}
          aria-hidden
        />
      )}

      <div className="min-w-0">
        <p
          className={`truncate font-semibold tracking-[-0.01em] text-white/92 ${SIZE_TEXT[size]}`}
        >
          {name}
        </p>
        <p
          className={`text-[10px] font-bold uppercase tracking-[0.14em] ${TYPE_ACCENT[type]}`}
        >
          {TYPE_LABEL[type]}
        </p>
      </div>
    </div>
  );
}
