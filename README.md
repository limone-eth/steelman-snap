# steelman-snap

A Farcaster bot that replies with a **Steelman / Weakman / Common-ground** [Snap](https://docs.farcaster.xyz/snap/spec-overview) on any cast you tag it on.

Tag `@steelmanbot` (or whatever username you give it) on a contentious cast and it replies with a server-driven Snap card that lets readers:

1. Read the **strongest** version of the argument the cast is making
2. Read the **weakest** version (an honest weakman, not a strawman)
3. Read what both sides could **agree on** — the underlying value or factual claim
4. Rate "did this change my mind?" on a 1–5 slider

The slider feedback is aggregated per steelman, so future readers see the running average.

## Why a Snap and not just a text reply

Snaps are server-driven UI cards rendered inside a cast. The agent doesn't have to fit everything into 320 characters of text — it returns a JSON tree with buttons, sliders, and stateful views. Every button press re-fetches the snap with a new state, so a single cast embed becomes a small interactive widget. This is the right shape for "show me three perspectives and collect a rating," which doesn't fit in plain text.

## Architecture

```
   Farcaster                         Vercel                       OpenRouter
   ─────────                         ──────                       ──────────
                                                                        
  user @-mentions       ─Neynar─►   /api/webhook  ──────────────►  generateSteelman
   the bot on a              webhook                                {strong, weak, agree}
   contentious cast                       │
                                          │  saveSteelman(id, ...)
                                          ▼                            
                                       Upstash                          
                                        Redis                            
                                          ▲                            
                                          │                            
   reader opens     ─Farcaster─►   /api/snap/[id]   ─loadSteelman─►  buildSnap(view)
   the snap card        client      (returns JSON                       │
                                     element tree)  ◄───────────────────┘
                                          │                            
   reader taps      ─POST──────►   /api/snap/feedback                    
   a button or             with    (view switch OR                       
   submits slider     {inputs}      addRating)                           
                                                                        
```

Two endpoints under `api/snap/` are all the snap server needs:

- `GET /api/snap/[id]` — initial render. Returns the `strong` view by default.
- `POST /api/snap/feedback?id=...&view=...` — handles both view switches and rating submissions, returns a fresh snap tree for the new state.

The webhook at `POST /api/webhook` is the only Farcaster-side entry point. It listens for Neynar `cast.created` events, filters to mentions of the agent, resolves the cast being argued (parent if the trigger is a reply, otherwise the trigger itself), generates the three passages via OpenRouter, persists them under a 6-byte id, and replies with the snap URL embedded.

## Layout

```
api/
  webhook.js              Neynar mention → steelman → reply with snap embed
  snap/
    [id].js               GET initial snap
    feedback.js           POST view-switch + rating submit
lib/
  steelman.js             OpenRouter call → {strong, weak, agree}
  snap-builder.js         Builds the snap JSON tree per view
  storage.js              Upstash Redis: steelmans + ratings
  farcaster.js            postCast (with embed support)
  neynar.js               getCastByHash via x402
  x402.js                 x402 payment + Neynar hub submitMessage
  custody.js              ethers Wallet from CUSTODY_PRIVATE_KEY
  openrouter.js           OpenAI-compatible client pointed at OpenRouter
  config.js               Neynar / USDC constants
package.json
vercel.json
.env.example
```

## Setup

You'll need:

- A **Farcaster account** for the bot, with a registered FID, a custody EVM key, and an Ed25519 signer key. (If you don't have these yet, the [farcaster-agent](https://github.com/limone-eth/farcaster-agent) repo this project descends from has scripts to register one.)
- An **OpenRouter API key** — https://openrouter.ai/keys
- An **Upstash Redis** database (free tier is fine) — https://upstash.com/
- Some **USDC on Base** in the custody wallet — Neynar's hub charges via x402 micropayments per cast and per API read (~0.01 USDC each).
- A **Neynar webhook** filtered to mentions of your agent FID, pointed at your deployed `/api/webhook`.

### Local

```bash
git clone https://github.com/limone-eth/steelman-snap
cd steelman-snap
npm install
cp .env.example .env
# fill in .env (see below)
npx vercel dev
```

### Deploy to Vercel

```bash
npx vercel --prod
```

Set the same env vars in the Vercel project settings. `VERCEL_URL` is auto-populated and used as the public base for snap URLs, so you don't need to set `SNAP_PUBLIC_URL` unless you're on a custom domain.

## Environment variables

```
# OpenRouter (LLM)
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-4o          # optional

# Farcaster agent identity
CUSTODY_PRIVATE_KEY=0x...                # pays Neynar x402 + signs hub messages
SIGNER_PRIVATE_KEY=...                   # ed25519 hex, no 0x — signs casts
AGENT_FID=12345
AGENT_USERNAME=steelmanbot               # without @, used to detect mentions

# Upstash Redis (snap state)
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...

# Snap server (optional — defaults to https://$VERCEL_URL)
# SNAP_PUBLIC_URL=https://steelman.example.com
```

## How the snap state machine works

A Snap is just JSON. Every GET / POST returns a complete UI tree. There are no client-side tabs — the server decides what to render based on which view the user is currently on.

`lib/snap-builder.js` exposes one function:

```js
buildSnap(steelman, view, stats) → { version, ui: { elements: {...} } }
```

Where `view` is one of `strong | weak | agree | rated`. The first three render the same shell — a header with the original cast quote, the chosen passage, three view-switch buttons, a 1–5 slider, and a footer with the running average. The `rated` view is a confirmation card shown after a slider submission.

Buttons declare a `submit` action that POSTs to `/api/snap/feedback?id=<id>&view=<view>`. The slider submit button uses the same target URL, but the form payload includes `{ inputs: { rating: <1..5> } }`. The feedback endpoint reads `inputs.rating`: if present, it records the rating and returns the `rated` view; if absent, it just returns the requested `view` with fresh stats.

## Cost notes

The hot path on every mention costs roughly:

- **0.01 USDC** to fetch the parent cast via Neynar (`getCastByHash`)
- **0.01 USDC** to submit the reply cast to the Neynar hub
- **~$0.001–0.01** for the OpenRouter call, depending on model

Snap reads (`/api/snap/[id]`) and feedback POSTs are free — they hit Upstash, not Neynar.

## Credits

The Farcaster custody / signer / x402 plumbing is lifted from [limone-eth/farcaster-agent](https://github.com/limone-eth/farcaster-agent).

## License

MIT
