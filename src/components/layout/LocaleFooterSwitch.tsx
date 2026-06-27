"use client";
import { useState } from "react";
import { Check, Globe2 } from "lucide-react";
import { useLocale, type PoplogLocale } from "@/context/LocaleContext";

const OPTIONS = [
  { labelKey: "locale.portuguese" as const, language: "pt-BR", region: "BR" },
  { labelKey: "locale.english" as const, language: "en-US", region: "US" },
] satisfies Array<{
  labelKey: "locale.portuguese" | "locale.english";
  language: PoplogLocale["interfaceLanguage"];
  region: PoplogLocale["region"];
}>;

export default function LocaleFooterSwitch() {
  const { locale, saveLocale, t } = useLocale();
  const [saving, setSaving] = useState(false);

  async function choose(language: PoplogLocale["interfaceLanguage"], region: PoplogLocale["region"]) {
    setSaving(true);
    try {
      // saveLocale() já faz PATCH /api/user/locale (seta cookies via Set-Cookie) e
      // chama setLocaleState() internamente — todos os componentes com useLocale()
      // re-renderizam imediatamente. window.location.reload() era redundante e
      // causava um refresh completo desnecessário.
      await saveLocale({
        interfaceLanguage: language,
        catalogLanguage: language,
        region,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 md:items-end">
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
        <Globe2 size={13} aria-hidden />
        {saving ? t("locale.saving") : t("locale.switch")}
      </span>
      <div className="flex rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
        {OPTIONS.map((option) => {
          const active = locale.catalogLanguage === option.language && locale.region === option.region;
          return (
            <button
              key={`${option.language}:${option.region}`}
              type="button"
              disabled={saving || active}
              onClick={() => void choose(option.language, option.region)}
              className={[
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px] font-black uppercase tracking-[0.08em] transition",
                active
                  ? "bg-white text-zinc-950"
                  : "text-white/45 hover:bg-white/[0.06] hover:text-white/75",
                saving ? "opacity-60" : "",
              ].join(" ")}
            >
              {t(option.labelKey)}
              {active && <Check size={12} aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
