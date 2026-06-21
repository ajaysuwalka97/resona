# Resona — Hackathon Build Spec (24h)

**For the build agent (Claude Code):** Build exactly what is in scope. Do not add tests, auth flows, extra screens, retries, or abstractions beyond what is listed. Read the NON-GOALS section before writing code, and again before adding anything not explicitly requested. This is a 24-hour live-demo build. Scope discipline beats completeness.

---

## 1. The one demo beat (the whole point)

> A user drops their LinkedIn, talks through what they're actually wrestling with, and a stranger from the network owner's graph surfaces — someone the user has no way of knowing — with a reason so specific to their situation that they immediately want the intro.

Everything in this build exists to make that single moment land on a projector in front of judges. The "reason" line is the product. Protect it.

### Cast (use these names in prompts and seed data)
- **Umang** — the user. The person talking to the agent. Knows none of the network.
- **Ajay** — the network owner. The graph belongs to him. He makes the warm intros.
- **Resona** — the voice agent that talks with Umang. (Demo-day name.)

The key fact: **every person Resona surfaces is non-obvious to Umang**, because they come from Ajay's network, not Umang's. The "wow" is NOT recognition surprise ("oh right, I forgot about them"). It is **earned trust in a stranger** — Resona understood Umang's situation so precisely that he'll take an intro to someone he's never heard of.

---

## 2. The golden path (rehearsed end-to-end flow)

This is a single scripted scenario. Build for THIS path. Do not build general-purpose handling.

**Demo user context (Umang, real):** Co-founder of TruCommerce (trucommerce.ai), agentic-commerce infrastructure — connects brand catalogs to AI agent surfaces (ChatGPT, Gemini, Perplexity, Claude). $120K ARR. Contracts with Amazon, ITC, Ferrari car parts, US skincare brands. Partners: Razorpay, PineLabs. **Closing a seed round — lead secured, ~$700K of the round already committed.** IIT Bombay founders.

**Flow:**

1. **Open (familiar).** Umang's LinkedIn is already loaded (see §5 — cached, not live-fetched on stage). Resona greets with familiarity:
   > "Umang — TruCommerce, the agentic-commerce infra layer, plugging brand catalogs into ChatGPT and Gemini. And you're mid-raise, right?"

2. **Probe 1 (the crown jewel — infers the gap under the stated ask).** Resona must NOT ask "what are you raising?" It must infer that a founder with a lead + $700K committed is *mid-close, not shopping for leads*, and probe the real gap:
   > "Congrats on the lead and the commitments — that's most of the round done. So when you say you're raising, what's the part that's *actually* still open? Filling the rest with anyone, or holding allocation for someone specific?"
   - Expected user reply (Umang): "Holding ~$300K for someone strategic — ideally someone who can open brand/retail doors, since our customers are CPG and D2C."

3. **Probe 2 (lock the persona).**
   > "Got it — so not a financial investor. A distribution unlock. Someone who's scaled commerce and can walk you into brand decision-makers, who also writes angel checks. That the shape?"
   - Expected reply: "Exactly."

4. **Match A — distribution axis (the reveal; card animates in).** Resona surfaces an **operator-turned-investor**: someone who was a commerce-at-scale operator and now angel-invests, with brand/retail relationships and a warm tie to Ajay. The "why" carries situation-fit + non-obvious selection + trust bridge. (Why-spine in §4; live framing stitched from Umang's words.)

5. **"Find me another" — WITH added context.** Umang doesn't just say "another" — he adds a constraint, e.g. *"someone who could help me actually close the round faster, not just distribution."* Resona re-steers on the new axis. This shows live re-routing, not list-paging.

6. **Match B — conviction/credibility axis.** A *different* unstated need: someone who built in a category VCs misread and got it funded anyway — who can lend category conviction / vouch to the investors still on the fence about "agentic commerce." Explicitly a different axis than Match A.

7. **Hard cap + continuation.** After two matches, Resona does NOT keep offering more. It pivots to action:
   > "Between distribution and conviction, that covers the two gaps in your raise — want me to draft the intro to whichever's more urgent?"
   - On yes: Resona drafts a tight 3-line intro (from Umang to the chosen person, via Ajay) **on screen**. Demo ends on this concrete artifact.

---

## 3. Architecture

- **Runtime:** OpenAI Agents SDK (TypeScript) — `RealtimeAgent` + `RealtimeSession`.
- **Transport:** **WebRTC** (browser client). NOT WebSocket. WebRTC handles audio in/out automatically; WebSocket would force manual audio + mute plumbing we don't want.
- **Model:** the current `gpt-realtime` speech-to-speech model.
- **Install:** `npm install @openai/agents @openai/agents-extensions` plus a minimal server framework and `zod` for the tool schema.
- **Async tool calls:** rely on the SDK/model's native async function calling — Resona keeps talking while the match tool runs (no dead air on stage). Do not build custom "thinking" stalls; let the model bridge naturally, but DO give it a verbal bridge instruction in the prompt ("while the tool runs, say you're looking across the network").
- **Key handling (REQUIRED):** the OpenAI API key must NEVER reach the browser. Build a tiny backend endpoint that mints a short-lived realtime session token; the browser connects with that token over WebRTC. Do not hardcode the API key in frontend JS.
- **Voice:** pick one of the expressive realtime voices; warm, unhurried. (Cedar/Marin or equivalent.)

### Pre-flight (do this in the first 10 minutes, before building anything else)
Verify the OpenAI API key can actually access the realtime model. If it can't, nothing downstream works — surface this immediately.

---

## 4. The match tool (REAL curated data, real reasoning shape)

The match tool reads from a **real, curated dataset** — `candidates.json`, a frozen export of ~100 enriched real people from the network owner's graph (transformed from a wiki of 726 contacts; the ~600 stub files were deliberately excluded). The intelligence is in the conversation + the why-spine; the *authenticity* is in the real data. This is what makes "judge grabs the mic" a strength instead of a risk — an off-script ask returns a real, textured person, not a mock.

### Data source
- **File:** `candidates.json` — copy it into the build repo as **static local seed data**. Do NOT reach back into any other project live. Treat it as frozen and immutable for the build.
- **Object shape (per candidate):** `id`, `name`, `headline`, `axis_tags[]`, `domain[]`, `background`, `tie_to_ajay{how, since, strength, note}`, `investor_signal`, `enrichment_level` (`golden` | `enriched` | `tag-only`).

### The Tier-2 gate (CRITICAL — this is the safety rule for open-tryability)
The matcher must **only ever surface candidates with `enrichment_level` of `golden` or `enriched`. NEVER `tag-only`.** A `tag-only` person has signal but no real texture; surfacing one produces a flat "why" live on stage. Gating to golden+enriched guarantees that whatever a judge asks, the match that comes back has enough background + tie_to_ajay for the "why" to land. This rule is non-negotiable.

### Tool contract
- **Name:** `find_match`
- **Input (from Resona, zod-validated):**
  - `axis`: enum — `"distribution" | "conviction"` (Resona sets this based on the conversation; Match A → distribution, Match B → conviction). For off-script judge asks, axis may be inferred more loosely from the request.
  - `situation_summary`: string — Resona's one-line read of the user's current need (used for live framing)
- **Behavior:**
  - **Golden path:** pin to the two `golden`-flagged candidates by `id` (see §4a). Deterministic — the rehearsed reveal always returns the right person.
  - **Off-script (judge tries it):** query the `golden` + `enriched` set, match on `axis_tags` / `domain` / `situation_summary`, return the best real fit. Never `tag-only`.
- **Output:** the matched candidate object + a `why_spine` (composed from that candidate's real `background` + `tie_to_ajay` — see hybrid model below).

### 4a. The two golden-path candidate IDs
Pin these two real people (from `candidates.json`, flagged `enrichment_level: "golden"`) to the golden path:
- **Match A — distribution axis:** "devendra-agrawal"
- **Match B — conviction axis:** "owais-chunawala"

Their `background` and `tie_to_ajay` are hand-enriched and demo-solid. The golden-path reveal narrates from THESE objects specifically.

### Hybrid "why" model (real-data spine + live framing)
For each match, build a **why_spine** from the candidate's REAL `background` and `tie_to_ajay` fields — the fixed skeleton of the reasoning (selection logic, trust bridge, specific facts). Resona then wraps live conversational framing around it, referencing what the user actually said. The spine is structure to fit into, not a script read verbatim — it guarantees the demo-critical logic lands while sounding composed-in-the-moment. Because the facts come from real data, the "why" is authentic, not fabricated.

The why_spine has four parts, composed from the candidate object:
- **selection** — why THIS person over others on the axis (from `background` + `domain`)
- **fit** — how their background maps to the user's specific situation
- **trust_bridge** — the warm-intro credibility (from `tie_to_ajay` — how/since/strength). LOAD-BEARING: the user is trusting a stranger; never weaken or omit this.
- **frame** — the one-line reframe of what this match means for the user's actual gap

**Golden-path why_spines (Match A distribution / Match B conviction):** these two are hand-enriched in §4a's golden objects — the selection/fit/trust_bridge/frame should be sharp and rehearsed against the TruCommerce scenario (mid-close founder → needs strategic capital, not money). Author the exact spine text for these two yourself; do not let the build agent generate them generically.

**Off-script why_spines:** composed live from whatever real candidate the matcher returns. Rougher than the golden two, but real — which is the point when a judge is testing authenticity.

---

## 5. LinkedIn fetch (Apify, cached for demo)

- Use Apify for the LinkedIn fetch — it's reliable and legitimate to show.
- **BUT: never let the demo depend on a cold Apify run completing live on stage.** Apify actor runs can take 20–60s+ and occasionally stall. Dead air kills the open.
- **Pattern:** pre-run Umang's profile before the demo, cache the result. The on-stage "fetch" is a ~3s animated beat over cached data. Keep live Apify wired in for legitimacy / non-demo profiles, but the golden-path user is cached.
- The open's wow is *Resona knowing Umang* — not the plumbing that got the data.

---

## 6. Resona's system prompt (the discipline that separates connector from form)

The single biggest failure mode is Resona sounding like **a form wearing a voice** ("What industry? What stage? What's your ask?"). That reads as fake instantly. The win is Resona probing like a sharp human connector — hearing the real ask under the stated one.

Prompt must encode:
- **Persona:** a warm, sharp super-connector's assistant. Speaks like a person who's made hundreds of intros, not a survey. Unhurried, curious, specific.
- **Inference discipline:** do NOT ask what's already inferable. From Umang's loaded context (mid-raise, lead + $700K committed), infer he's *mid-close* and probe the *gap*, not the basics. Probe 1 is the test of this.
- **One question at a time.** Never stack questions. Let the user talk.
- **Tool-timing:** call `find_match` only after the persona/axis is clear (post Probe 2 for Match A; after the user's added-context constraint for Match B). While the tool runs, keep the conversation alive verbally.
- **Why delivery:** deliver the why_spine's logic, wrapped in framing that references what the user actually said. Never read it flat. Never weaken the trust_bridge — it's load-bearing (Umang's trusting a stranger).
- **Hard cap:** after two matches, stop offering more; pivot to drafting the intro.
- **Intro draft:** tight, 3 lines, warm, from Umang via Ajay. No fluff.

---

## 7. Build order (scaffold-first; load-bearing wall first)

Build the complete ugly skeleton end-to-end, THEN polish for delight. But the first plank must be the riskiest dependency, so a failure surfaces early and cheap.

1. **Wall (first, ~couple hrs):** Agents SDK quickstart running in-browser over WebRTC + ONE dummy `find_match` returning hardcoded JSON. Prove: Resona holds a turn, fires the tool mid-conversation, keeps talking, resumes cleanly. UGLY. No styling. **Use a dummy here on purpose — the wall tests the voice/tool loop, which doesn't need real data.** If this can't hold, fall back to text-conversation + visual reveal NOW while it's cheap.
2. **Skeleton:** swap the dummy for the real `candidates.json` loader. Implement `find_match` with the **Tier-2 gate** (golden+enriched only, never tag-only) and golden-id pinning. Wire the full golden path turn-by-turn. End-to-end walkable, ugly.
3. **Prompt + golden why_spines:** make Probe 1 infer the gap; author the two golden why_spines sharp against the TruCommerce scenario. This is where disproportionate care goes — it's invisible in code and obvious on stage.
4. **Reveal card + animation:** the delight surface. Card animates in on match. Timing IS the wow — make it crisp.
5. **Apify cached fetch + familiar open beat.**
6. **Intro-draft continuation.**
7. **Polish + rehearse** the golden path until timing is muscle memory. Then test ONE off-script ask yourself to confirm the gate holds.

---

## 8. NON-GOALS (do not build these — they steal polish from the one beat)

- ❌ No live connection back to the source People project. `candidates.json` is copied in as frozen static data.
- ❌ No expansion of the dataset mid-build. Work with the frozen ~100. Refine data later only if the demo exposes a real gap.
- ❌ The matcher NEVER surfaces `tag-only` candidates. Golden + enriched only.
- ❌ No live-scrape dependency on stage. Cached profile for the demo user.
- ❌ No more than two matches. Hard cap. A third thin match reverses the thesis.
- ❌ Only ONE continuation: draft the intro. No "find another / more context / schedule" branches beyond the scripted "find me another."
- ❌ No auth, no user accounts, no persistence, no database. In-memory seeds.
- ❌ No telephony, no WhatsApp, no SIP. Web only.
- ❌ No speaker diarization / multi-party audio. Single user talking to Resona.
- ❌ No test suite, no CI, no deployment pipeline. It runs locally for a live demo.
- ❌ No general-purpose conversation handling. Build the golden path, not a product.
- ❌ Do not gold-plate. If a plugin or instinct suggests adding structure "for robustness," it's out of scope unless it serves the one beat.

---

## 9. Success test (how we know it's done)

A judge watches Umang talk to Resona for ~90 seconds and thinks: *"It understood his actual situation, and it pulled someone he'd never have found, for a reason that's obviously right — I'd take that intro."* Twice, on two different axes. Ending on a drafted intro on screen.

If the build does that one thing flawlessly, it's done. Everything else is noise.