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
  config.js               Farcaster contracts + Neynar / USDC constants
scripts/                  One-time agent bootstrap (not used at runtime)
  create-wallet.js        Generate a fresh EVM wallet locally
  setup.js                Orchestrator: register FID + signer + swap + save creds
  register-fid.js         Register a new FID on Optimism
  add-signer.js           Generate Ed25519 signer + add via KeyGateway
  swap-to-usdc.js         ETH → USDC on Base via Uniswap V3 (for x402)
  credentials.js          Local credentials.json store
package.json
vercel.json
.env.example
```

## Setup

You'll need:

- An **EVM wallet** with ~$1 of ETH on Optimism + ~$0.50 of ETH on Base — used by the setup scripts to register the bot's FID, add a signer, and pay Neynar's hub via x402 micropayments at runtime.
- An **OpenRouter API key** — https://openrouter.ai/keys
- An **Upstash Redis** database (free tier is fine) — https://upstash.com/
- A **Neynar webhook** filtered to mentions of your agent FID, pointed at your deployed `/api/webhook`.

### Bootstrap the agent identity

The `scripts/` directory contains everything needed to create a Farcaster account programmatically — no Neynar dev portal, no Warpcast QR code, no human in the loop. This is the same flow Neynar documents in [Autonomous Farcaster agent](https://docs.neynar.com/docs/autonomous-farcaster-agent), lifted from [rishavmukherji/farcaster-agent](https://github.com/rishavmukherji/farcaster-agent) and stripped to the essentials (no auto-bridging — bring your own pre-funded wallet).

```bash
git clone https://github.com/limone-eth/steelman-snap
cd steelman-snap
npm install

# 1. Generate a fresh EVM wallet locally
npm run create-wallet
#    → prints an address, saves the key to .wallet-pending.json (gitignored)

# 2. Fund that address with ~$1 of ETH:
#       - Optimism: ~0.0015 ETH (FID registration + signer gas)
#       - Base:     ~0.0002 ETH (gets swapped to USDC for x402)

# 3. Run the rest of the bootstrap
npm run setup
#    → reads .wallet-pending.json, registers FID, adds signer, swaps to USDC,
#      saves credentials.json, prints the env vars you need
```

`npm run setup` will:

1. Verify the wallet has enough ETH on Optimism + Base
2. Register a new FID via the `IdGateway` contract on Optimism
3. Generate an Ed25519 signer keypair locally and add it via `KeyGateway` with a self-signed EIP-712 key request
4. Swap a slice of Base ETH → USDC via Uniswap V3 (for x402 micropayments to Neynar's hub)
5. Write `credentials.json` (gitignored), delete `.wallet-pending.json`, and print the env-var lines you need to paste into `.env`

Total cost: roughly **$0.50–$1.00** depending on gas. After it finishes you'll have an agent that can post casts entirely under your own keys — no managed services involved.

If you'd rather provide your own pre-existing wallet, skip `create-wallet` and pass `PRIVATE_KEY` directly:

```bash
PRIVATE_KEY=0x... npm run setup
```

Individual steps are also exposed as scripts in case you want to run them à la carte:

```bash
PRIVATE_KEY=0x... npm run register     # just register the FID
PRIVATE_KEY=0x... npm run add-signer   # just add a new signer to an existing FID
PRIVATE_KEY=0x... npm run swap         # just swap ETH → USDC on Base
npm run credentials list               # show stored agents in credentials.json
```

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
