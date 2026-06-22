export type DebugEndpointResult = {
  label: string;
  url: string;
  ok: boolean;
  status: number;
  elapsedMs: number;
  data: unknown;
  error?: string;
};

export type DebugCard = {
  title: string;
  subtitle?: string;
  meta?: string[];
  badges?: string[];
  image?: string | null;
};

export type DebugTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

export type DebugSection = {
  title: string;
  description?: string;
  cards?: DebugCard[];
  tables?: DebugTable[];
  bullets?: string[];
};

export type ApiDebugResponse = {
  api: string;
  configured: boolean;
  ok: boolean;
  elapsedMs: number;
  callCount: number;
  summary: {
    description: string;
    bestFor: string[];
    dataTypes: string[];
    impression: string;
  };
  capabilities: string[];
  sections: DebugSection[];
  observations: string[];
  endpoints: DebugEndpointResult[];
};

export function jsonHeaders() {
  return {
    "Cache-Control": "no-store",
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function compact(values: Array<string | undefined | null | false>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

export function limitText(value: unknown, fallback = "N/D", max = 160): string {
  const text = readString(value) ?? fallback;
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

export function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

export async function timedJson(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<DebugEndpointResult> {
  const started = Date.now();
  const displayUrl = sanitizeUrl(url);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const elapsedMs = Date.now() - started;
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    return {
      label,
      url: displayUrl,
      ok: response.ok,
      status: response.status,
      elapsedMs,
      data,
      error: response.ok ? undefined : summarizeError(data),
    };
  } catch (error) {
    return {
      label,
      url: displayUrl,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      data: null,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

export function buildMissingKeyResponse(api: string, envName: string): ApiDebugResponse {
  return {
    api,
    configured: false,
    ok: false,
    elapsedMs: 0,
    callCount: 0,
    summary: {
      description: `${api} nao esta configurada.`,
      bestFor: [],
      dataTypes: [],
      impression: `Defina ${envName} no .env.local para ativar este bloco.`,
    },
    capabilities: [],
    sections: [],
    observations: [`Chave ausente: ${envName}.`],
    endpoints: [],
  };
}

export function responseEnvelope(input: Omit<ApiDebugResponse, "ok" | "elapsedMs" | "callCount"> & {
  startedAt: number;
  endpoints: DebugEndpointResult[];
}): ApiDebugResponse {
  return {
    ...input,
    ok: input.endpoints.some((endpoint) => endpoint.ok),
    elapsedMs: Date.now() - input.startedAt,
    callCount: input.endpoints.length,
  };
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of ["api_key", "apiKey", "apikey"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[server-key]");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function summarizeError(data: unknown): string {
  if (typeof data === "string") return limitText(data, "Erro HTTP", 220);
  const record = asRecord(data);
  return readString(record.status_message) ??
    readString(record.Error) ??
    readString(record.message) ??
    readString(record.error) ??
    "Resposta HTTP sem sucesso.";
}
