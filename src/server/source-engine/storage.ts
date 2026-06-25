import { STORAGE_PATHS, sanitizeAssetKey, type AssetKind } from "./asset-keys";
import { resolveAssetUrl } from "./asset-urls";
import { DEFAULT_CATALOG_LANGUAGE, normalizeCatalogLanguage } from "./locale";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type AssetVariant = "card" | "detail" | "hero" | "main";
export type AssetFormat = "webp" | "avif" | "jpg" | "png";

export type StoredAsset = {
  assetKey: string;
  contentType: string;
  buffer: Buffer;
  size: number;
  updatedAt: Date;
};

export type StorageProvider = {
  kind: "local" | "remote";
  getPublicUrl(assetKey: string): string;
  read(assetKey: string): Promise<StoredAsset | null>;
  write(input: {
    assetKey: string;
    buffer: Buffer;
    contentType?: string | null;
  }): Promise<{ assetKey: string; publicUrl: string }>;
  delete(assetKey: string): Promise<boolean>;
  exists(assetKey: string): Promise<boolean>;
};

function localStorageRoot(): string {
  const configured = (process.env.POPLOG_LOCAL_STORAGE_ROOT ?? "storage").trim();
  if (!configured || configured === "storage" || configured === "./storage") {
    return path.join(/*turbopackIgnore: true*/ process.cwd(), "storage");
  }

  if (path.isAbsolute(configured)) {
    return path.normalize(configured);
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), configured);
}

export function assetKeyToLocalPath(assetKey: string): string {
  const safeKey = sanitizeAssetKey(assetKey);
  const root = localStorageRoot();
  const absolute = path.join(root, safeKey);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Asset key escapes local storage root.");
  }
  return absolute;
}

export async function ensureStorageDirectories(): Promise<void> {
  await Promise.all(
    Object.values(STORAGE_PATHS).map((folder) =>
      mkdir(path.join(localStorageRoot(), folder), { recursive: true }),
    ),
  );
}

function contentTypeForAssetKey(assetKey: string, fallback = "application/octet-stream"): string {
  const ext = path.extname(assetKey).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return fallback;
}

export function buildAssetKey(input: {
  imdbId: string;
  kind: AssetKind;
  language?: string | null;
  variant?: AssetVariant;
  format?: AssetFormat;
}): string {
  const language = normalizeCatalogLanguage(input.language ?? DEFAULT_CATALOG_LANGUAGE);
  const variant = input.variant ?? "main";
  const format = input.format ?? "webp";
  return `${STORAGE_PATHS[input.kind]}/${input.imdbId}/${language}/${variant}.${format}`;
}

class LocalStorageProvider implements StorageProvider {
  kind = "local" as const;

  getPublicUrl(assetKey: string): string {
    return resolveAssetUrl(sanitizeAssetKey(assetKey)) ?? "";
  }

  async read(assetKey: string): Promise<StoredAsset | null> {
    const safeKey = sanitizeAssetKey(assetKey);
    const filePath = assetKeyToLocalPath(safeKey);
    try {
      const [buffer, info] = await Promise.all([readFile(filePath), stat(filePath)]);
      return {
        assetKey: safeKey,
        contentType: contentTypeForAssetKey(safeKey),
        buffer,
        size: info.size,
        updatedAt: info.mtime,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async write(input: {
    assetKey: string;
    buffer: Buffer;
    contentType?: string | null;
  }): Promise<{ assetKey: string; publicUrl: string }> {
    const safeKey = sanitizeAssetKey(input.assetKey);
    const filePath = assetKeyToLocalPath(safeKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.buffer);
    return { assetKey: safeKey, publicUrl: this.getPublicUrl(safeKey) };
  }

  async delete(assetKey: string): Promise<boolean> {
    const filePath = assetKeyToLocalPath(assetKey);
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false;
      throw error;
    }
  }

  async exists(assetKey: string): Promise<boolean> {
    try {
      await stat(assetKeyToLocalPath(assetKey));
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false;
      throw error;
    }
  }
}

type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when POPLOG_STORAGE_DRIVER=s3.`);
  }
  return value;
}

function s3Config(): S3Config {
  return {
    endpoint: requiredEnv("POPLOG_S3_ENDPOINT").replace(/\/+$/, ""),
    region: process.env.POPLOG_S3_REGION?.trim() || "us-east-1",
    bucket: requiredEnv("POPLOG_S3_BUCKET"),
    accessKeyId: requiredEnv("POPLOG_S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("POPLOG_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env.POPLOG_S3_FORCE_PATH_STYLE !== "false",
    publicBaseUrl:
      process.env.POPLOG_ASSET_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
      process.env.NEXT_PUBLIC_POPLOG_ASSET_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
      null,
  };
}

function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hmac(key: Buffer | string, input: string): Buffer {
  return createHmac("sha256", key).update(input).digest();
}

function amzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    long: iso,
    short: iso.slice(0, 8),
  };
}

function encodeS3Key(assetKey: string): string {
  return sanitizeAssetKey(assetKey)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

class S3StorageProvider implements StorageProvider {
  kind = "remote" as const;
  private readonly config = s3Config();

  getPublicUrl(assetKey: string): string {
    const safeKey = sanitizeAssetKey(assetKey);
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl}/${safeKey}`;
    }
    return this.objectUrl(safeKey).toString();
  }

  async read(assetKey: string): Promise<StoredAsset | null> {
    const response = await this.request("GET", assetKey);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`S3 read failed with HTTP ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      assetKey: sanitizeAssetKey(assetKey),
      contentType: response.headers.get("content-type") ?? contentTypeForAssetKey(assetKey),
      buffer,
      size: Number(response.headers.get("content-length") ?? buffer.length),
      updatedAt: response.headers.get("last-modified")
        ? new Date(response.headers.get("last-modified")!)
        : new Date(),
    };
  }

  async write(input: {
    assetKey: string;
    buffer: Buffer;
    contentType?: string | null;
  }): Promise<{ assetKey: string; publicUrl: string }> {
    const safeKey = sanitizeAssetKey(input.assetKey);
    const response = await this.request("PUT", safeKey, {
      body: input.buffer,
      contentType: input.contentType ?? contentTypeForAssetKey(safeKey),
    });
    if (!response.ok) throw new Error(`S3 write failed with HTTP ${response.status}.`);
    return { assetKey: safeKey, publicUrl: this.getPublicUrl(safeKey) };
  }

  async delete(assetKey: string): Promise<boolean> {
    const response = await this.request("DELETE", assetKey);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`S3 delete failed with HTTP ${response.status}.`);
    return true;
  }

  async exists(assetKey: string): Promise<boolean> {
    const response = await this.request("HEAD", assetKey);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`S3 HEAD failed with HTTP ${response.status}.`);
    return true;
  }

  private objectUrl(assetKey: string): URL {
    const endpoint = new URL(this.config.endpoint);
    const encodedKey = encodeS3Key(assetKey);
    if (this.config.forcePathStyle) {
      endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/${this.config.bucket}/${encodedKey}`;
      return endpoint;
    }
    endpoint.hostname = `${this.config.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/${encodedKey}`;
    return endpoint;
  }

  private async request(
    method: "DELETE" | "GET" | "HEAD" | "PUT",
    assetKey: string,
    options: { body?: Buffer; contentType?: string } = {},
  ): Promise<Response> {
    const safeKey = sanitizeAssetKey(assetKey);
    const url = this.objectUrl(safeKey);
    const bodyHash = sha256Hex(options.body ?? "");
    const date = amzDate();
    const headers = new Headers({
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": date.long,
    });
    if (options.contentType) headers.set("content-type", options.contentType);

    const signedHeaders = [...headers.keys(), "host"].sort();
    const canonicalHeaders = signedHeaders
      .map((key) => `${key}:${key === "host" ? url.host : headers.get(key)}`)
      .join("\n");
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      `${canonicalHeaders}\n`,
      signedHeaders.join(";"),
      bodyHash,
    ].join("\n");
    const credentialScope = `${date.short}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      date.long,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, date.short), this.config.region), "s3"),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
    );

    return fetch(url, {
      method,
      headers,
      body: method === "PUT" ? options.body as unknown as BodyInit : undefined,
    });
  }
}

let storageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (storageProvider) return storageProvider;

  const driver = (process.env.POPLOG_STORAGE_DRIVER ?? "local").trim().toLowerCase();
  if (driver === "local") {
    storageProvider = new LocalStorageProvider();
    return storageProvider;
  }

  if (driver === "s3" || driver === "remote") {
    storageProvider = new S3StorageProvider();
    return storageProvider;
  }

  throw new Error(`Unsupported POPLOG_STORAGE_DRIVER "${driver}".`);
}
