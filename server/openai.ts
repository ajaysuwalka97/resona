const OPENAI_BASE_URL = "https://api.openai.com/v1";
const REALTIME_MODEL = "gpt-realtime-2";

type RealtimeClientSecretResponse = {
  value: string;
  expires_at: number;
  session: {
    id: string;
    model: string;
  };
};

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }
  return apiKey;
}

export async function mintRealtimeClientSecret(): Promise<RealtimeClientSecretResponse> {
  const apiKey = getApiKey();

  const response = await fetch(`${OPENAI_BASE_URL}/realtime/client_secrets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenAI realtime token mint failed (${response.status}): ${detail.slice(0, 280)}`,
    );
  }

  const payload = (await response.json()) as RealtimeClientSecretResponse;
  return payload;
}

export async function verifyRealtimeModelAccess() {
  const result = await mintRealtimeClientSecret();
  return {
    ok: Boolean(result.value),
    model: result.session?.model ?? REALTIME_MODEL,
    expires_at: result.expires_at,
  };
}
