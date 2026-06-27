"use client";
import { useEffect, useState } from "react";
import { Check, Globe2 } from "lucide-react";
import { useInterfaceMessages } from "@/hooks/useInterfaceMessages";

type LocalePayload = {
  ok: boolean;
  locale: {
    interfaceLanguage: string;
    catalogLanguage: string;
    region: string;
  };
};

const OPTIONS = [
  { labelKey: "locale.portuguese" as const, language: "pt-BR", region: "BR" },
  { labelKey: "locale.english" as const, language: "en-US", region: "US" },
];

export default function LocaleFooterSwitch() {
  const { t } = useInterfaceMessages();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locale, setLocale] = useState({ interfaceLanguage: "pt-BR", catalogLanguage: "pt-BR", region: "BR" });

  useEffect(() => {
    let active = true;
    fetch("/api/user/locale", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: LocalePayload) => {
        if (active && payload.ok) setLocale(payload.locale);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function choose(language: string, region: string) {
    setSaving(true);
    try {
      const response = await fetch("/api/user/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interfaceLanguage: language,
          catalogLanguage: language,
          region,
        }),
      });
      const payload = await response.json() as LocalePayload;
      if (payload.ok) {
        setLocale(payload.locale);
        setOpen(false);
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <footer className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="mb-2 w-48 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/95 p-1 shadow-2xl shadow-black/40 backdrop-blur">
          {OPTIONS.map((option) => {
            const active = locale.catalogLanguage === option.language && locale.region === option.region;
            return (
              <button
                key={`${option.language}:${option.region}`}
                type="button"
                disabled={saving}
                onClick={() => void choose(option.language, option.region)}
                className="flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm font-semibold text-zinc-200 hover:bg-white/[0.06] disabled:opacity-50"
              >
                <span>{t(option.labelKey)}</span>
                <span className="flex items-center gap-2 text-xs text-zinc-500">
                  {option.language} · {option.region}
                  {active && <Check size={14} className="text-emerald-300" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-zinc-950/85 px-3 text-xs font-black text-white shadow-xl shadow-black/30 backdrop-blur transition hover:bg-zinc-900"
        aria-expanded={open}
        aria-label={saving ? t("locale.saving") : t("locale.switch")}
      >
        <Globe2 size={15} />
        {locale.catalogLanguage} · {locale.region}
      </button>
    </footer>
  );
}
