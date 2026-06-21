import "dotenv/config";

import crypto from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import { getLinkedInSnapshot } from "./linkedin-cache";
import { scoreCandidateWithLlm } from "./match-scorer";
import { mintRealtimeClientSecret, verifyRealtimeModelAccess } from "./openai";
import { getTelemetrySummary, recordTelemetryEvent } from "./telemetry";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const configuredApiKey = process.env.RESONA_API_KEY?.trim() ?? "";
const allowUnauthenticatedLoopback = (() => {
  const raw = process.env.ALLOW_UNAUTH_LOOPBACK?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return raw === "true" || raw === "1" || raw === "yes";
})();
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
const rateLimitUsesTrustedIp = (() => {
  const raw = process.env.RATE_LIMIT_USE_TRUSTED_IP?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
})();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT?.trim() || "64kb";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  return (
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "127.0.0.1"
  );
}

function isLoopbackRequest(request: Request): boolean {
  return isLoopbackAddress(request.socket.remoteAddress ?? undefined);
}

function authDigest(value: string): Buffer {
  return crypto.createHash("sha256").update(`resona-auth-v1:${value}`).digest();
}

function requireApiAuth(request: Request, response: Response, next: NextFunction) {
  if (configuredApiKey) {
    const provided = request.header("x-resona-api-key")?.trim() ?? "";
    const isMatch = crypto.timingSafeEqual(
      authDigest(provided),
      authDigest(configuredApiKey),
    );
    if (!provided || !isMatch) {
      response.status(401).json({
        ok: false,
        error: "Missing or invalid x-resona-api-key.",
      });
      return;
    }
    next();
    return;
  }

  if (allowUnauthenticatedLoopback && isLoopbackRequest(request)) {
    next();
    return;
  }

  response.status(503).json({
    ok: false,
    error:
      "RESONA_API_KEY is not configured and non-loopback access is blocked. Set RESONA_API_KEY (and VITE_RESONA_API_KEY) to enable authenticated access.",
  });
}

function createRateLimitMiddleware(
  maxRequests: number,
  windowMs: number,
  label: string,
) {
  const entries = new Map<string, RateLimitEntry>();
  let requestsSinceSweep = 0;

  function sweepExpiredEntries(now: number) {
    for (const [key, value] of entries.entries()) {
      if (now >= value.resetAt) {
        entries.delete(key);
      }
    }
  }

  return (request: Request, response: Response, next: NextFunction) => {
    const key = rateLimitUsesTrustedIp
      ? (request.ip || request.socket.remoteAddress || "unknown")
      : (request.socket.remoteAddress || "unknown");
    const now = Date.now();
    requestsSinceSweep += 1;
    if (requestsSinceSweep >= 100 || entries.size > 5_000) {
      sweepExpiredEntries(now);
      requestsSinceSweep = 0;
    }
    const existing = entries.get(key);
    if (!existing || now >= existing.resetAt) {
      entries.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      response.setHeader("Retry-After", retryAfterSeconds.toString());
      response.status(429).json({
        ok: false,
        error: `Rate limit exceeded for ${label}. Retry in ${retryAfterSeconds}s.`,
      });
      return;
    }

    existing.count += 1;
    next();
  };
}

function resolveFrontendOrigin(): string {
  const explicitOrigin = process.env.FRONTEND_ORIGIN?.trim();
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const apiBaseUrl = process.env.VITE_API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    return "http://localhost:5173";
  }

  try {
    return new URL(apiBaseUrl).origin.replace(":8787", ":5173");
  } catch {
    return "http://localhost:5173";
  }
}

const frontendOrigin = resolveFrontendOrigin();
if (Number.isFinite(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

app.use(
  cors({
    origin: frontendOrigin,
  }),
);
app.use(express.json({ limit: requestBodyLimit }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "resona-server",
    timestamp: new Date().toISOString(),
  });
});

app.get(
  "/api/preflight/realtime",
  requireApiAuth,
  createRateLimitMiddleware(60, 60_000, "preflight-realtime"),
  async (_request, response) => {
  try {
    const status = await verifyRealtimeModelAccess();
    response.json({
      ok: true,
      status,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown preflight error",
    });
  }
});

app.post(
  "/api/realtime/session",
  requireApiAuth,
  createRateLimitMiddleware(30, 60_000, "realtime-session"),
  async (_request, response) => {
  try {
    const token = await mintRealtimeClientSecret();
    response.json({
      value: token.value,
      expires_at: token.expires_at,
      session: token.session,
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to mint token",
    });
  }
});

app.post(
  "/api/linkedin/fetch",
  requireApiAuth,
  createRateLimitMiddleware(40, 60_000, "linkedin-fetch"),
  async (request, response) => {
  const linkedinUrl = String(request.body?.linkedinUrl ?? "").trim();
  if (!linkedinUrl) {
    response.status(400).json({
      ok: false,
      error: "linkedinUrl is required.",
    });
    return;
  }

  try {
    const snapshot = await getLinkedInSnapshot(linkedinUrl);
    if (!snapshot) {
      response.status(422).json({
        ok: false,
        error:
          "Could not load a reliable profile context for this URL. Please retry or provide a different profile.",
      });
      return;
    }
    response.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to fetch profile",
    });
  }
});

app.post(
  "/api/match/score",
  requireApiAuth,
  createRateLimitMiddleware(240, 60_000, "match-score"),
  async (request, response) => {
  try {
    const score = await scoreCandidateWithLlm(request.body);
    response.json({
      ok: true,
      score,
    });
  } catch (error) {
    response.status(422).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to score candidate.",
    });
  }
});

app.post(
  "/api/telemetry/events",
  requireApiAuth,
  createRateLimitMiddleware(800, 60_000, "telemetry-events"),
  (request, response) => {
  try {
    const record = recordTelemetryEvent(request.body);
    response.status(202).json({
      ok: true,
      event: record.event,
      timestamp: record.timestamp,
    });
  } catch (error) {
    response.status(422).json({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid telemetry event.",
    });
  }
});

app.get(
  "/api/telemetry/summary",
  requireApiAuth,
  createRateLimitMiddleware(60, 60_000, "telemetry-summary"),
  (_request, response) => {
  response.json({
    ok: true,
    summary: getTelemetrySummary(),
  });
});

app.listen(port, () => {
  console.log(`[resona-server] listening on http://localhost:${port}`);
});
