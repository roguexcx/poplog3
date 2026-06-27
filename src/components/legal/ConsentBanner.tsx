"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import {
  acceptEssentialLegalConsent,
  createDefaultConsentRecord,
  readLocalConsentRecord,
  writeLocalConsentRecord,
  type ConsentSource,
  type LegalConsentRecord,
  type OptionalConsentCategory,
} from "@/lib/legal/consent-storage";
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from "@/lib/legal/legal-content";
import { useLocale } from "@/context/LocaleContext";

type OptionalCategoryKey = "analytics" | "ads" | "personalization";

const OPTIONAL_CATEGORIES: { key: OptionalCategoryKey; labelKey: string; descriptionKey: string }[] = [
  { key: "analytics", labelKey: "legal.consent.category.analytics", descriptionKey: "legal.consent.category.analytics.description" },
  { key: "ads", labelKey: "legal.consent.category.ads", descriptionKey: "legal.consent.category.ads.description" },
  { key: "personalization", labelKey: "legal.consent.category.personalization", descriptionKey: "legal.consent.category.personalization.description" },
];

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function buildEnabledCategory(enabled: boolean): OptionalConsentCategory {
  return {
    enabled,
    legalBasis: enabled ? "consent" : "not_applicable",
    updatedAt: new Date().toISOString(),
  };
}

async function persistConsent(record: LegalConsentRecord) {
  try {
    await fetch("/api/legal/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
      keepalive: true,
    });
  } catch {
    // Best-effort: localStorage remains the source of truth for anonymous visitors.
  }
}

export default function ConsentBanner() {
  const { ui } = useLocale();
  const [record, setRecord] = useState<LegalConsentRecord | null>(null);
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [choices, setChoices] = useState<Record<OptionalCategoryKey, boolean>>({
    analytics: false,
    ads: false,
    personalization: false,
  });

  useEffect(() => {
    let current = readLocalConsentRecord();
    if (!current) {
      current = createDefaultConsentRecord({
        termsVersion: LEGAL_TERMS_VERSION,
        privacyVersion: LEGAL_PRIVACY_VERSION,
        interfaceLanguage: readCookie("poplog_interface_language") ?? "pt-BR",
        catalogLanguage: readCookie("poplog_catalog_language") ?? "pt-BR",
        region: readCookie("poplog_region") ?? "BR",
      });
      writeLocalConsentRecord(current);
    }
    setRecord(current);
    setChoices({
      analytics: current.cookies.analytics.enabled,
      ads: current.cookies.ads.enabled,
      personalization: current.cookies.personalization.enabled,
    });
    const needsConsent = !current.terms.accepted || current.terms.version !== LEGAL_TERMS_VERSION;
    setVisible(needsConsent);
  }, []);

  function finalize(base: LegalConsentRecord, categories: Record<OptionalCategoryKey, boolean>, source: ConsentSource) {
    const withCategories = writeLocalConsentRecord({
      ...base,
      cookies: {
        ...base.cookies,
        analytics: buildEnabledCategory(categories.analytics),
        ads: buildEnabledCategory(categories.ads),
        personalization: buildEnabledCategory(categories.personalization),
      },
    });
    const accepted = acceptEssentialLegalConsent(withCategories, {
      source,
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION,
    });
    setRecord(accepted);
    setVisible(false);
    void persistConsent(accepted);
  }

  function acceptAll() {
    if (!record) return;
    const all = { analytics: true, ads: true, personalization: true };
    finalize(record, all, "banner");
  }

  function acceptEssentialOnly() {
    if (!record) return;
    finalize(record, { analytics: false, ads: false, personalization: false }, "banner");
  }

  function savePreferences() {
    if (!record) return;
    finalize(record, choices, "modal");
  }

  if (!visible || !record) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[120] px-3 pb-3 sm:px-6 sm:pb-6">
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0b0e1c]/95 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-400/[0.14] text-indigo-200">
              <Cookie className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-[-0.01em] text-white/90">
                {ui("legal.consent.title")}
              </p>
              <p className="mt-1 text-[12.5px] leading-6 text-white/55">
                {ui("legal.consent.description")}{" "}
                <Link href="/legal" className="font-semibold text-indigo-200 underline-offset-2 hover:underline">
                  {ui("legal.consent.policyLink")}
                </Link>
                .
              </p>
            </div>
          </div>

          {managing ? (
            <div className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              {OPTIONAL_CATEGORIES.map((category) => (
                <label
                  key={category.key}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]"
                >
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-bold text-white/85">{ui(category.labelKey)}</span>
                    <span className="block text-[11px] leading-5 text-white/40">{ui(category.descriptionKey)}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={choices[category.key]}
                    onChange={(event) =>
                      setChoices((current) => ({ ...current, [category.key]: event.target.checked }))
                    }
                    className="size-4 shrink-0 accent-indigo-400"
                  />
                </label>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {managing ? (
              <button
                type="button"
                onClick={savePreferences}
                className="order-1 h-10 rounded-full bg-indigo-500 px-5 text-[12px] font-black uppercase tracking-[0.12em] text-white transition hover:bg-indigo-400 sm:order-3"
              >
                {ui("legal.consent.save")}
              </button>
            ) : (
              <button
                type="button"
                onClick={acceptAll}
                className="order-1 h-10 rounded-full bg-indigo-500 px-5 text-[12px] font-black uppercase tracking-[0.12em] text-white transition hover:bg-indigo-400 sm:order-3"
              >
                {ui("legal.consent.acceptAll")}
              </button>
            )}
            <button
              type="button"
              onClick={acceptEssentialOnly}
              className="order-2 h-10 rounded-full border border-white/[0.1] bg-white/[0.03] px-5 text-[12px] font-black uppercase tracking-[0.12em] text-white/65 transition hover:bg-white/[0.07] hover:text-white/85 sm:order-1"
            >
              {ui("legal.consent.essentialOnly")}
            </button>
            <button
              type="button"
              onClick={() => setManaging((value) => !value)}
              className="order-3 h-10 rounded-full px-5 text-[12px] font-black uppercase tracking-[0.12em] text-white/45 transition hover:text-white/70 sm:order-2"
            >
              {managing ? ui("legal.consent.hide") : ui("legal.consent.customize")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
