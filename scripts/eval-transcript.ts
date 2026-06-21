import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateTranscriptQuality,
  parseTranscriptTurns,
} from "../src/realtime/conversationHeuristics";

function main() {
  const transcriptPath = process.argv[2];
  if (!transcriptPath) {
    console.error("Usage: npx tsx scripts/eval-transcript.ts <transcript-file>");
    process.exit(1);
  }

  const absolutePath = resolve(process.cwd(), transcriptPath);
  const transcript = readFileSync(absolutePath, "utf8");
  const turns = parseTranscriptTurns(transcript);
  const summary = evaluateTranscriptQuality(transcript);

  console.log(
    JSON.stringify(
      {
        file: absolutePath,
        parsedTurns: turns.length,
        summary,
      },
      null,
      2,
    ),
  );
}

main();
