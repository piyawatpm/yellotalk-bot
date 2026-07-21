// Transparent proxy to Groq's API, deployed on Vercel and pinned to a US region
// (see ../vercel.json) so Groq — which geo-blocks Hong Kong / China datacenter
// IPs with a 403 — sees an allowed US IP instead.
//
// No secrets live here: the caller's Authorization header (your Groq key) is
// forwarded through untouched, so the relay never stores a key.
//
// bot-server points at this via the GROQ_BASE_URL env var, e.g.
//   GROQ_BASE_URL=https://<your-project>.vercel.app/api/openai/v1
// groq-sdk then requests /api/openai/v1/chat/completions here, which this
// function forwards to https://api.groq.com/openai/v1/chat/completions.
export default async function handler(req, res) {
  try {
    const seg = req.query.path || [];
    const p = Array.isArray(seg) ? seg.join('/') : String(seg);
    const qi = req.url.indexOf('?');
    const qs = qi >= 0 ? req.url.slice(qi) : '';
    const target = 'https://api.groq.com/' + p + qs;

    const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
    if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'];

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = typeof req.body === 'string' ? req.body
           : req.body != null ? JSON.stringify(req.body) : undefined;
    }

    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: { message: 'groq relay error: ' + e.message } });
  }
}
