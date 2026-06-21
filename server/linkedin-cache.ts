import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type LinkedInProfileSnapshot = {
  name: string;
  company: string;
  summary: string;
  raise_context: string;
  source: "cache" | "apify";
  fetched_at: string;
};

type CachedLinkedInEntry = {
  snapshot: LinkedInProfileSnapshot;
  cached_at: string;
};

type LinkedInCacheFile = Record<string, CachedLinkedInEntry>;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const APIFY_TIMEOUT_MS = parsePositiveNumber(
  process.env.APIFY_TIMEOUT_MS,
  45000,
);
const LINKEDIN_CACHE_TTL_MS = parsePositiveNumber(
  process.env.LINKEDIN_CACHE_TTL_MS,
  1000 * 60 * 60 * 6,
);
const LINKEDIN_CACHE_FILE =
  process.env.LINKEDIN_CACHE_FILE?.trim() ||
  path.join(process.cwd(), ".cache", "linkedin-profile-cache.json");

const linkedInCache = new Map<string, CachedLinkedInEntry>();
const inFlightFetches = new Map<string, Promise<LinkedInProfileSnapshot>>();
let cacheLoadPromise: Promise<void> | null = null;
let cachePersistQueue: Promise<void> = Promise.resolve();

function normalizeActorId(actorId: string): string {
  return actorId.includes("/") ? actorId.replace(/\//g, "~") : actorId;
}

function normalizeLinkedInUrl(linkedinUrl: string): string {
  const parsed = new URL(linkedinUrl.trim());
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith("linkedin.com")) {
    throw new Error("Only linkedin.com profile URLs are supported.");
  }

  const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  if (!pathname.startsWith("/in/")) {
    throw new Error(
      "Expected a LinkedIn person profile URL in the form linkedin.com/in/...",
    );
  }

  return `https://www.linkedin.com${pathname}`;
}

function loadCacheIfNeeded(): Promise<void> {
  if (!cacheLoadPromise) {
    cacheLoadPromise = (async () => {
      try {
        const raw = await readFile(LINKEDIN_CACHE_FILE, "utf8");
        const parsed = JSON.parse(raw) as LinkedInCacheFile;
        Object.entries(parsed).forEach(([key, value]) => {
          if (value?.snapshot && value?.cached_at) {
            linkedInCache.set(key, value);
          }
        });
      } catch {
        // Cache file is optional on first run.
      }
    })();
  }
  return cacheLoadPromise;
}

async function persistCache() {
  const writeOperation = cachePersistQueue.then(async () => {
    const serializable: LinkedInCacheFile = {};
    linkedInCache.forEach((value, key) => {
      serializable[key] = value;
    });
    await mkdir(path.dirname(LINKEDIN_CACHE_FILE), { recursive: true });
    await writeFile(
      LINKEDIN_CACHE_FILE,
      JSON.stringify(serializable, null, 2),
      "utf8",
    );
  });

  cachePersistQueue = writeOperation.catch(() => undefined);
  await writeOperation;
}

function isFresh(entry: CachedLinkedInEntry): boolean {
  const cachedAt = Date.parse(entry.cached_at);
  if (Number.isNaN(cachedAt)) {
    return false;
  }
  return Date.now() - cachedAt <= LINKEDIN_CACHE_TTL_MS;
}

function toCacheSnapshot(entry: CachedLinkedInEntry): LinkedInProfileSnapshot {
  return {
    ...entry.snapshot,
    source: "cache",
  };
}

function isMeaningfulSnapshot(snapshot: LinkedInProfileSnapshot): boolean {
  const hasName = snapshot.name.trim() !== "" && snapshot.name !== "Unknown";
  const hasCompany =
    snapshot.company.trim() !== "" && snapshot.company !== "No headline";
  return hasName || hasCompany;
}

async function writeSnapshotToCache(
  cacheKey: string,
  snapshot: LinkedInProfileSnapshot,
) {
  if (!isMeaningfulSnapshot(snapshot)) {
    return;
  }
  linkedInCache.set(cacheKey, {
    snapshot,
    cached_at: snapshot.fetched_at,
  });
  try {
    await persistCache();
  } catch (error) {
    console.warn(
      "[linkedin-cache] profile cached in memory but failed to persist on disk",
      error instanceof Error ? error.message : "unknown write error",
    );
  }
}

function getOrCreateInFlightFetch(
  cacheKey: string,
): Promise<LinkedInProfileSnapshot> {
  const existing = inFlightFetches.get(cacheKey);
  if (existing) {
    return existing;
  }

  const created = (async () => {
    const liveSnapshot = await fetchViaApify(cacheKey);
    await writeSnapshotToCache(cacheKey, liveSnapshot);
    return liveSnapshot;
  })().finally(() => {
    inFlightFetches.delete(cacheKey);
  });

  inFlightFetches.set(cacheKey, created);
  return created;
}

async function fetchViaApify(
  linkedinUrl: string,
): Promise<LinkedInProfileSnapshot> {
  const token = process.env.APIFY_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID;

  if (!token || !actorId) {
    throw new Error(
      "Apify is not configured. Set APIFY_TOKEN and APIFY_ACTOR_ID on the server.",
    );
  }

  const normalizedActorId = normalizeActorId(actorId);
  const endpoint =
    `https://api.apify.com/v2/acts/${encodeURIComponent(normalizedActorId)}` +
    "/run-sync-get-dataset-items";
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), APIFY_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profileUrls: [linkedinUrl],
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Apify profile fetch failed (${response.status}): ${errorText.slice(0, 220)}`,
      );
    }

    const items = (await response.json()) as Array<Record<string, unknown>>;
    const first = items?.[0];
    if (!first) {
      throw new Error("Apify returned no profile rows for this LinkedIn URL.");
    }
    if (typeof first.error === "string" && first.error.trim()) {
      throw new Error(
        `Apify actor returned an error payload: ${first.error.slice(0, 220)}`,
      );
    }

    const fullName = String(
      first.fullName ?? first.name ?? first.full_name ?? "Unknown",
    );
    const headline = String(
      first.headline ?? first.position ?? first.title ?? "No headline",
    );
    const about = String(first.about ?? first.summary ?? "");
    const snapshot: LinkedInProfileSnapshot = {
      name: fullName,
      company: headline,
      summary: about || "Fetched from Apify profile snapshot.",
      raise_context: "Live profile fetched for this user context.",
      source: "apify",
      fetched_at: new Date().toISOString(),
    };
    if (!isMeaningfulSnapshot(snapshot)) {
      throw new Error(
        "Apify responded without usable profile fields (name/headline/summary).",
      );
    }
    return snapshot;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Apify profile fetch timed out after ${APIFY_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLinkedInSnapshot(
  linkedinUrl: string,
): Promise<LinkedInProfileSnapshot | null> {
  await loadCacheIfNeeded();
  const cacheKey = normalizeLinkedInUrl(linkedinUrl);
  const cached = linkedInCache.get(cacheKey);

  if (cached && isFresh(cached) && isMeaningfulSnapshot(cached.snapshot)) {
    return toCacheSnapshot(cached);
  }

  try {
    const liveSnapshot = await getOrCreateInFlightFetch(cacheKey);
    return liveSnapshot;
  } catch (error) {
    if (cached && isMeaningfulSnapshot(cached.snapshot)) {
      return toCacheSnapshot(cached);
    }

    if (error instanceof Error) {
      throw error;
    }
    throw new Error("LinkedIn profile fetch failed.");
  }
}
