import "dotenv/config";

import cors from "cors";
import express from "express";

import { getLinkedInSnapshot } from "./linkedin-cache";
import { scoreCandidateWithLlm } from "./match-scorer";
import { mintRealtimeClientSecret, verifyRealtimeModelAccess } from "./openai";

const app = express();
const port = Number(process.env.PORT ?? 8787);

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

app.use(
  cors({
    origin: frontendOrigin,
  }),
);
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "resona-server",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/preflight/realtime", async (_request, response) => {
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

app.post("/api/realtime/session", async (_request, response) => {
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

app.post("/api/linkedin/fetch", async (request, response) => {
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

app.post("/api/match/score", async (request, response) => {
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

app.listen(port, () => {
  console.log(`[resona-server] listening on http://localhost:${port}`);
});
