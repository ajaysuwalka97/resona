import { z } from "zod";

const telemetryEventSchema = z.object({
  event: z
    .string()
    .trim()
    .min(1)
    .max(80),
  session_id: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional(),
  payload: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
});

type TelemetryEventInput = z.infer<typeof telemetryEventSchema>;

type TelemetryRecord = TelemetryEventInput & {
  timestamp: string;
};

const MAX_TELEMETRY_EVENTS = 1000;
const MAX_TELEMETRY_PAYLOAD_BYTES = 8_192;
const MAX_TELEMETRY_PAYLOAD_DEPTH = 6;
const telemetryEvents: TelemetryRecord[] = [];
const eventCounterByName = new Map<string, number>();

function computePayloadDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") {
    return depth;
  }
  if (Array.isArray(value)) {
    return value.reduce(
      (maxDepth, entry) => Math.max(maxDepth, computePayloadDepth(entry, depth + 1)),
      depth + 1,
    );
  }
  return Object.values(value).reduce(
    (maxDepth, entry) => Math.max(maxDepth, computePayloadDepth(entry, depth + 1)),
    depth + 1,
  );
}

function validateTelemetryPayload(payload: unknown): void {
  if (payload === undefined) {
    return;
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_TELEMETRY_PAYLOAD_BYTES) {
    throw new Error(
      `Telemetry payload exceeds ${MAX_TELEMETRY_PAYLOAD_BYTES} characters.`,
    );
  }
  const depth = computePayloadDepth(payload);
  if (depth > MAX_TELEMETRY_PAYLOAD_DEPTH) {
    throw new Error(
      `Telemetry payload nesting exceeds maximum depth of ${MAX_TELEMETRY_PAYLOAD_DEPTH}.`,
    );
  }
}

export function recordTelemetryEvent(input: unknown): TelemetryRecord {
  const parsed = telemetryEventSchema.parse(input);
  validateTelemetryPayload(parsed.payload);
  const record: TelemetryRecord = {
    ...parsed,
    timestamp: new Date().toISOString(),
  };

  telemetryEvents.push(record);
  if (telemetryEvents.length > MAX_TELEMETRY_EVENTS) {
    telemetryEvents.shift();
  }
  eventCounterByName.set(
    record.event,
    (eventCounterByName.get(record.event) ?? 0) + 1,
  );

  return record;
}

export function getTelemetrySummary() {
  return {
    total_events: telemetryEvents.length,
    by_event: Object.fromEntries(eventCounterByName),
    recent: telemetryEvents.slice(-50),
  };
}
