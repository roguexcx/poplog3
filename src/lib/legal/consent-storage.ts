export type ConsentSource = "banner" | "modal" | "profile" | "admin_import" | "migration";

export type OptionalConsentCategory = {
  enabled: boolean;
  legalBasis: "consent" | "legitimate_interest" | "not_applicable";
  updatedAt: string;
};

export type LegalConsentRecord = {
  schemaVersion: 1;
  subjectId: string | null;
  anonymousId: string;
  terms: {
    accepted: boolean;
    version: string;
    acceptedAt: string | null;
    source?: ConsentSource;
  };
  privacy: {
    accepted: boolean;
    version: string;
    acceptedAt: string | null;
    source?: ConsentSource;
  };
  cookies: {
    essential: {
      enabled: true;
      legalBasis: "contract" | "legitimate_interest";
    };
    analytics: OptionalConsentCategory;
    ads: OptionalConsentCategory;
    personalization: OptionalConsentCategory;
  };
  locale: {
    interfaceLanguage: string;
    catalogLanguage: string;
    region: string;
  };
  audit?: {
    ipHash?: string | null;
    userAgentHash?: string | null;
    lastSyncedAt?: string | null;
    storage?: "localStorage" | "database" | "cookie" | "import";
  };
  createdAt: string;
  updatedAt: string;
};

const CONSENT_STORAGE_KEY = "poplog:legal-consent:v1";

function createAnonymousId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function createDefaultConsentRecord(options: {
  subjectId?: string | null;
  termsVersion: string;
  privacyVersion: string;
  interfaceLanguage?: string;
  catalogLanguage?: string;
  region?: string;
}): LegalConsentRecord {
  const now = new Date().toISOString();
  const disabled = { enabled: false, legalBasis: "not_applicable" as const, updatedAt: now };

  return {
    schemaVersion: 1,
    subjectId: options.subjectId ?? null,
    anonymousId: createAnonymousId(),
    terms: { accepted: false, version: options.termsVersion, acceptedAt: null },
    privacy: { accepted: false, version: options.privacyVersion, acceptedAt: null },
    cookies: {
      essential: { enabled: true, legalBasis: "contract" },
      analytics: disabled,
      ads: disabled,
      personalization: disabled,
    },
    locale: {
      interfaceLanguage: options.interfaceLanguage ?? "pt-BR",
      catalogLanguage: options.catalogLanguage ?? "pt-BR",
      region: options.region ?? "BR",
    },
    audit: { storage: "localStorage" },
    createdAt: now,
    updatedAt: now,
  };
}

export function readLocalConsentRecord(): LegalConsentRecord | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LegalConsentRecord;
    return parsed?.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalConsentRecord(record: LegalConsentRecord): LegalConsentRecord {
  const next = { ...record, updatedAt: new Date().toISOString() };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function acceptEssentialLegalConsent(
  record: LegalConsentRecord,
  options: { source: ConsentSource; termsVersion?: string; privacyVersion?: string },
): LegalConsentRecord {
  const now = new Date().toISOString();
  return writeLocalConsentRecord({
    ...record,
    terms: {
      accepted: true,
      version: options.termsVersion ?? record.terms.version,
      acceptedAt: now,
      source: options.source,
    },
    privacy: {
      accepted: true,
      version: options.privacyVersion ?? record.privacy.version,
      acceptedAt: now,
      source: options.source,
    },
    updatedAt: now,
  });
}
