# groq-relay

A tiny Vercel proxy that lets the Hong Kong bot server keep using **Groq**.

Groq geo-blocks the HK/China datacenter IP (returns `403 Forbidden`). This relay
runs on Vercel pinned to a **US region** (`iad1`), so Groq sees an allowed US IP.
It forwards requests transparently — your Groq key is passed through in the
`Authorization` header and never stored here.

## Deploy (once, ~2 min)

```bash
cd groq-relay
npx vercel --prod        # first run: log in, accept defaults; it prints a URL
```

You'll get a URL like `https://groq-relay-xxxx.vercel.app`.

## Wire it up

On the bot server, set one env var (no code change — groq-sdk reads it):

```
GROQ_BASE_URL=https://groq-relay-xxxx.vercel.app/api/openai/v1
```

Then restart the bot. Requests now go:

```
bot-server (HK) → this relay (US, iad1) → api.groq.com → 200 OK
```

## Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://groq-relay-xxxx.vercel.app/api/openai/v1/models \
  -H "Authorization: Bearer <your-groq-key>"
# expect 200
```
