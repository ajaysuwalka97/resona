import { z } from "zod";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MATCH_SCORER_MODEL = process.env.MATCH_SCORER_MODEL ?? "gpt-4.1-mini";

function resolveScorerTimeoutMs(): number {
  const parsed = Number(process.env.MATCH_SCORER_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 5_000;
}

const MATCH_SCORER_TIMEOUT_MS = resolveScorerTimeoutMs();

const candidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  brings: z.array(
    z.object({
      kind: z.enum([
        "capability",
        "resource",
        "judgment",
        "network",
        "lived_experience",
      ]),
      claim: z.string().min(1).max(260),
      evidence: z.string().min(1).max(900),
    }),
  ),
  triggerSurfaces: z.array(
    z.object({
      label: z.string().min(1).max(220),
      situationPattern: z.string().min(1).max(650),
      whyThisPerson: z.string().min(1).max(650),
      evidence: z.string().min(1).max(900),
    }),
  ),
});

const scoreRequestSchema = z.object({
  situation_summary: z.string().min(1).max(700),
  candidate: candidateSchema,
});

const scoreResponseSchema = z.object({
  complementarity: z.number().min(0).max(1),
  trigger: z.number().min(0).max(1),
  selectedBringIndices: z.array(z.number().int().min(0)).max(2),
  selectedTriggerIndex: z.number().int().min(0).nullable(),
  reason: z.string().min(1).max(280),
});

export type ScoreRequest = z.infer<typeof scoreRequestSchema>;
export type ScoreResponse = z.infer<typeof scoreResponseSchema>;

function sanitizePromptText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[`$]/g, "")
    .replace(/[<>{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function sanitizeScoreRequest(input: ScoreRequest): ScoreRequest {
  return {
    situation_summary: sanitizePromptText(input.situation_summary, 700),
    candidate: {
      ...input.candidate,
      name: sanitizePromptText(input.candidate.name, 120),
      brings: input.candidate.brings.map((bring) => ({
        ...bring,
        claim: sanitizePromptText(bring.claim, 260),
        evidence: sanitizePromptText(bring.evidence, 900),
      })),
      triggerSurfaces: input.candidate.triggerSurfaces.map((surface) => ({
        ...surface,
        label: sanitizePromptText(surface.label, 220),
        situationPattern: sanitizePromptText(surface.situationPattern, 650),
        whyThisPerson: sanitizePromptText(surface.whyThisPerson, 650),
        evidence: sanitizePromptText(surface.evidence, 900),
      })),
    },
  };
}

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }
  return apiKey;
}

function buildSystemPrompt(): string {
  return [
    "You are a deterministic matchmaking evaluator for a live demo.",
    "Treat the ask as freeform: do not map needs into fixed categories.",
    "Score from grounded candidate evidence only.",
    "",
    "Scoring rubric:",
    "- complementarity (0..1): how strongly candidate brings cards complement the live blocker in situation_summary.",
    "- trigger (0..1): must be a specific, nameable reason this person clicks over peers for this situation.",
    "- If trigger justification is only broad category membership, trigger must be <= 0.2.",
    "- If evidence is generic/weak, lower scores accordingly.",
    "",
    "Selection rules:",
    "- selectedBringIndices: choose up to 2 indices from candidate.brings that best support complementarity.",
    "- selectedTriggerIndex: choose exactly one index from candidate.triggerSurfaces, or null if no specific trigger clears bar.",
    "",
    "Return strict JSON only with fields:",
    "{ complementarity, trigger, selectedBringIndices, selectedTriggerIndex, reason }",
  ].join("\n");
}

export async function scoreCandidateWithLlm(input: ScoreRequest): Promise<ScoreResponse> {
  const parsed = sanitizeScoreRequest(scoreRequestSchema.parse(input));
  const apiKey = getApiKey();

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    signal: AbortSignal.timeout(MATCH_SCORER_TIMEOUT_MS),
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MATCH_SCORER_MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify({
            situation_summary: parsed.situation_summary,
            candidate: parsed.candidate,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "candidate_match_score",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              complementarity: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              trigger: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              selectedBringIndices: {
                type: "array",
                maxItems: 2,
                items: {
                  type: "integer",
                  minimum: 0,
                },
              },
              selectedTriggerIndex: {
                anyOf: [
                  {
                    type: "integer",
                    minimum: 0,
                  },
                  {
                    type: "null",
                  },
                ],
              },
              reason: {
                type: "string",
                minLength: 1,
                maxLength: 280,
              },
            },
            required: [
              "complementarity",
              "trigger",
              "selectedBringIndices",
              "selectedTriggerIndex",
              "reason",
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenAI match scorer failed (${response.status}): ${detail.slice(0, 260)}`,
    );
  }

  const payload = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const rawContent = payload.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("OpenAI match scorer returned no message content.");
  }

  let parsedContent: unknown = null;
  try {
    parsedContent = JSON.parse(rawContent);
  } catch (error) {
    throw new Error(
      `OpenAI match scorer returned non-JSON content: ${
        error instanceof Error ? error.message : "parse failure"
      }`,
    );
  }

  return scoreResponseSchema.parse(parsedContent);
}
