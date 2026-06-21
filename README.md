# Resona

**Voice-powered warm intro matchmaker for a super-connector's network.**

Resona is a realtime voice agent that helps founders get the right introduction—not a keyword search, but a grounded match from a trusted network graph. A user shares their LinkedIn profile, talks through what they're actually wrestling with, and Resona surfaces one or two high-confidence people from the network owner's graph with a specific, situation-aware rationale. The session ends with a draft warm intro the founder can send today.

## Problem

Founders don't need more contacts—they need the *right* intro at the *right* moment. Generic networking tools surface obvious names from your own graph. Resona inverts that: it listens to a live need, probes for the real blocker under the stated ask, and recommends non-obvious people from someone else's curated network—people the founder has no way of knowing—with complementarity, trigger, and trust reasoning strong enough to earn a warm intro to a stranger.

## How it works

1. **Load context** — Paste a founder LinkedIn URL; Resona pulls profile context (cached or via Apify).
2. **Voice conversation** — OpenAI Realtime drives a natural, one-question-at-a-time dialogue over WebRTC.
3. **Grounded matching** — The `find_match` tool scores ~100 curated candidates on complementarity, trigger fit, and trust edge; only high-confidence matches surface (max two per session).
4. **Intro artifact** — Resona drafts a tight 3-line warm intro from the founder to the matched person, routed via the network owner.

## Tech stack

| Layer | Tools |
|-------|-------|
| **Voice agent** | [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) (`RealtimeAgent`, `RealtimeSession`), `gpt-realtime` speech-to-speech |
| **Transport** | WebRTC (browser client; API key never exposed to frontend) |
| **Frontend** | React 19, Vite, TypeScript |
| **Backend** | Express 5, TypeScript (`tsx`) |
| **Matching** | LLM scorer (`gpt-4.1-mini`), semantic prefilter, confidence gates, `why_spine` rationale composition |
| **Profile data** | Apify LinkedIn scraper + local JSON cache |
| **Validation** | Zod |
| **E2E** | Playwright |

## Demo

> **Add your demo link here before submission** — video, hosted app, or deck.

| Type | Link |
|------|------|
| Video / walkthrough | _TBD_ |
| Hosted app | _TBD_ |
| Slides / deck | _TBD_ |

### Run locally

**Prerequisites:** Node.js 20+, an OpenAI API key with Realtime access, optional Apify token for live LinkedIn fetches.

```bash
cp .env.example .env
# Edit .env — set OPENAI_API_KEY (required), APIFY_TOKEN (optional)

npm install
npm run dev
```

- Frontend: http://localhost:5173  
- API server: http://localhost:8787  

**Golden-path flow:** Load the demo LinkedIn profile → start a Resona session → talk through your raise/blocker → review 1–2 matches → draft the intro.

## Project structure

```
src/           React UI, realtime session, find_match tool, why_spine
server/        Express API — token minting, LinkedIn cache, LLM scorer
candidates.json  Curated network graph (~100 enriched contacts)
e2e/           Playwright smoke tests
```

## Environment variables

See [`.env.example`](.env.example). Required:

- `OPENAI_API_KEY` — Realtime + match scoring
- `VITE_API_BASE_URL` — Frontend → backend URL (default `http://localhost:8787`)

Optional: `APIFY_TOKEN`, `APIFY_ACTOR_ID`, `VITE_MATCH_MODE` (`real` | `dummy`).

## License

MIT — see [LICENSE](LICENSE).

## Author

Built for the Resona hackathon demo — [github.com/ajaysuwalka97/resona](https://github.com/ajaysuwalka97/resona).
