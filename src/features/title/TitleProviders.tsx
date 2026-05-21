import Image from "next/image";

import ContextualAttribution from "@/components/attribution/ContextualAttribution";
import { getProviderSourceIds } from "@/attribution/helpers";
import type { TitleProvider } from "./types";
import type { AvailabilityProvider } from "@/server/streaming/availability-service";

type TitleProvidersProps = {
  providers?: AvailabilityProvider[] | TitleProvider[];
};

type ProviderGroupType = "streaming" | "free" | "ads" | "rent-buy";

type ProviderGroup = {
  type: ProviderGroupType;
  items: MergedProvider[];
};

type MergedProvider = TitleProvider & {
  accessLabel?: string;
  isPreferred?: boolean;
};

const TYPE_LABEL: Record<ProviderGroupType, string> = {
  streaming: "Streaming",
  free: "Grátis",
  ads: "Com anúncios",
  "rent-buy": "Alugar ou comprar",
};

const TYPE_ACCENT: Record<ProviderGroupType, string> = {
  streaming: "text-cyan-200/80",
  free: "text-emerald-200/80",
  ads: "text-white/55",
  "rent-buy": "text-amber-200/80",
};

const TYPE_ORDER: ProviderGroupType[] = ["streaming", "free", "ads", "rent-buy"];

function dedupeProviders(providers: MergedProvider[]) {
  const map = new Map<string, MergedProvider>();

  for (const provider of providers) {
    const key = provider.name.trim().toLowerCase();

    if (!map.has(key)) {
      map.set(key, provider);
      continue;
    }

    const current = map.get(key)!;

    map.set(key, {
      ...current,
      deepLink: current.deepLink ?? provider.deepLink,
      logoUrl: current.logoUrl ?? provider.logoUrl,
      quality: current.quality ?? provider.quality,
      accessLabel: current.accessLabel ?? provider.accessLabel,
      isPreferred: current.isPreferred || provider.isPreferred,
    });
  }

  return Array.from(map.values());
}

function groupByType(
  providers: (AvailabilityProvider | TitleProvider)[]
): ProviderGroup[] {
  const streaming = dedupeProviders(
    providers
      .filter(
        (p) =>
          p.type === "streaming" ||
          ("normalizedType" in p && p.normalizedType === "subscription")
      )
      .map((p) => ({ ...p }))
  );

  const free = dedupeProviders(
    providers
      .filter(
        (p) =>
          p.type === "free" ||
          ("normalizedType" in p && p.normalizedType === "free")
      )
      .map((p) => ({ ...p }))
  );

  const ads = dedupeProviders(
    providers
      .filter(
        (p) =>
          p.type === "ads" ||
          ("normalizedType" in p && p.normalizedType === "ads")
      )
      .map((p) => ({ ...p }))
  );

  const rentBuyMap = new Map<
    string,
    {
      rent?: TitleProvider | AvailabilityProvider;
      buy?: TitleProvider | AvailabilityProvider;
    }
  >();

  for (const provider of providers) {
    const isRent =
      provider.type === "rent" ||
      ("normalizedType" in provider && provider.normalizedType === "rent");

    const isBuy =
      provider.type === "buy" ||
      ("normalizedType" in provider && provider.normalizedType === "buy");

    if (!isRent && !isBuy) continue;

    const key = provider.name.trim().toLowerCase();
    const current = rentBuyMap.get(key) ?? {};

    if (isRent) current.rent = provider;
    if (isBuy) current.buy = provider;

    rentBuyMap.set(key, current);
  }

  const rentBuy: MergedProvider[] = Array.from(rentBuyMap.values()).map(
  ({ rent, buy }) => {
    const base = rent ?? buy!;

    const rentIsPreferred =
      rent && "isPreferred" in rent ? Boolean(rent.isPreferred) : false;

    const buyIsPreferred =
      buy && "isPreferred" in buy ? Boolean(buy.isPreferred) : false;

    const baseIsPreferred =
      "isPreferred" in base ? Boolean(base.isPreferred) : false;

    return {
      ...base,
      type: base.type,
      deepLink: rent?.deepLink ?? buy?.deepLink ?? null,
      logoUrl: base.logoUrl ?? null,
      quality: rent?.quality ?? buy?.quality ?? null,
      isPreferred: baseIsPreferred || rentIsPreferred || buyIsPreferred,
      accessLabel: rent && buy ? "aluguel/compra" : rent ? "aluguel" : "compra",
    };
  }
);

  const groups: ProviderGroup[] = [
    { type: "streaming", items: streaming },
    { type: "free", items: free },
    { type: "ads", items: ads },
    { type: "rent-buy", items: rentBuy },
  ];

  return TYPE_ORDER.map((type) => groups.find((group) => group.type === type))
    .filter((group): group is ProviderGroup => Boolean(group))
    .filter((group) => group.items.length > 0);
}

export default function TitleProviders({ providers }: TitleProvidersProps) {
  const hasProviders = providers && providers.length > 0;
  const groups = hasProviders ? groupByType(providers!) : [];

  const sourcesUsed = getProviderSourceIds(providers);

  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-5 backdrop-blur-xl sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.10),transparent_50%)]"
        aria-hidden
      />

      <div
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
        aria-hidden
      />

      <div className="relative">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200/70">
            Onde assistir
          </p>

          <ContextualAttribution
            context="availability"
            sourcesUsed={sourcesUsed}
          />
        </div>

        {hasProviders ? (
          <div className="mt-4 flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.type} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-black uppercase tracking-[0.18em] ${TYPE_ACCENT[group.type]}`}
                  >
                    {TYPE_LABEL[group.type]}
                  </span>

                  <span className="h-px flex-1 bg-white/[0.06]" aria-hidden />

                  <span className="text-[10px] font-semibold text-white/40">
                    {group.items.length}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {group.items.map((p, idx) => (
                    <ProviderPill
                      key={`${group.type}-${p.name}-${idx}`}
                      provider={p}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] leading-6 text-white/45">
            Nenhuma disponibilidade encontrada no Brasil. Vai voltar nesta lista
            quando o título entrar em algum streaming, aluguel ou compra digital.
          </p>
        )}
      </div>
    </section>
  );
}

function ProviderPill({ provider }: { provider: MergedProvider }) {
  const inner = (
    <span
      className={[
        "inline-flex max-w-full items-center gap-2 rounded-2xl border py-2 pl-2 pr-3 text-[12px] font-semibold backdrop-blur-md transition duration-200",
        provider.isPreferred
          ? "border-cyan-300/30 bg-cyan-300/[0.08] text-white shadow-[0_0_24px_rgba(34,211,238,0.10)] hover:border-cyan-200/45 hover:bg-cyan-300/[0.12]"
          : "border-white/[0.08] bg-white/[0.04] text-white/90 hover:border-white/[0.18] hover:bg-white/[0.08]",
      ].join(" ")}
    >
      {provider.logoUrl ? (
        <Image
          src={provider.logoUrl}
          alt={provider.name}
          width={32}
          height={32}
          unoptimized
          className="h-7 w-7 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span
          className="h-7 w-7 shrink-0 rounded-md bg-white/10"
          aria-hidden
        />
      )}

      <span className="min-w-0 truncate">{provider.name}</span>

      {provider.isPreferred && (
        <span className="shrink-0 rounded-full border border-cyan-200/20 bg-cyan-300/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-cyan-100">
          Seu streaming
        </span>
      )}

      {provider.quality && (
        <span className="ml-1 shrink-0 rounded-full border border-white/[0.10] bg-black/35 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/55">
          {provider.quality}
        </span>
      )}
    </span>
  );

  if (provider.deepLink) {
    return (
      <a
        href={provider.deepLink}
        target="_blank"
        rel="noreferrer noopener"
        className="max-w-full"
        title={`Abrir em ${provider.name}`}
      >
        {inner}
      </a>
    );
  }

  return inner;
}
