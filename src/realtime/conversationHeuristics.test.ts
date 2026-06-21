import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STYLE_MEMORY,
  evaluateTranscriptQuality,
  inferStyleMemoryPatch,
  isAmbiguousShortReply,
  isIncompleteUtterance,
  isLikelyMatchRejection,
  mergeStyleMemory,
  parseTranscriptTurns,
  situationSummaryGroundedInUserSpeech,
  styleMemoryPromptLine,
} from "./conversationHeuristics";

test("infers concise/direct style preference from user phrasing", () => {
  const patch = inferStyleMemoryPatch("Keep it short and direct, no fluff.");
  assert.equal(patch.concise, true);
  assert.equal(patch.direct, true);
});

test("infers avoid-profile-recap from robotic feedback", () => {
  const patch = inferStyleMemoryPatch(
    "This sounds robotic and reads LinkedIn too much.",
  );
  assert.equal(patch.avoidProfileRecap, true);
});

test("detects likely match rejection language", () => {
  assert.equal(
    isLikelyMatchRejection("Nathan is not relevant for what I asked."),
    true,
  );
  assert.equal(
    isLikelyMatchRejection("Looks good, draft the intro."),
    false,
  );
});

test("blocks ambiguous and incomplete user replies before matching", () => {
  assert.equal(isAmbiguousShortReply("อ๋อ"), true);
  assert.equal(isAmbiguousShortReply("yeah sure"), true);
  assert.equal(
    isAmbiguousShortReply("Strategic investors for distribution unlock."),
    false,
  );
  assert.equal(isIncompleteUtterance("So I'm looking for..."), true);
  assert.equal(
    isIncompleteUtterance("Need distribution partners who can pilot next quarter."),
    false,
  );
});

test("requires situation summaries to stay grounded in user speech", () => {
  assert.equal(
    situationSummaryGroundedInUserSpeech(
      ["So I'm looking for...", "อ๋อ"],
      "Need a healthcare design partner for pilot validation.",
    ),
    false,
  );
  assert.equal(
    situationSummaryGroundedInUserSpeech(
      [
        "Need distribution partners in healthcare.",
        "Blocked by compliance decision-makers.",
      ],
      "Need distribution partners in healthcare blocked by compliance decision-makers.",
    ),
    true,
  );
});

test("merges style memory and renders prompt line", () => {
  const merged = mergeStyleMemory(DEFAULT_STYLE_MEMORY, {
    concise: true,
    avoidProfileRecap: true,
  });
  const promptLine = styleMemoryPromptLine(merged);
  assert.match(promptLine, /concise/i);
  assert.match(promptLine, /avoid profile-recital openings/i);
});

test("parses transcript turns and computes quality summary", () => {
  const transcript = [
    "Resona: Great to connect. What should this intro unlock?",
    "You: Strategic investors for distribution unlock.",
    "Resona: I don't have someone I'd stake a warm intro on for that, and I won't guess.",
  ].join("\n");

  const turns = parseTranscriptTurns(transcript);
  assert.equal(turns.length, 3);
  assert.equal(turns[0]?.role, "assistant");
  assert.equal(turns[1]?.role, "user");

  const summary = evaluateTranscriptQuality(transcript);
  assert.equal(summary.turnCount, 3);
  assert.equal(summary.assistantTurnCount, 2);
  assert.equal(summary.userTurnCount, 1);
  assert.equal(summary.noGuessBehaviorPresent, true);
});
