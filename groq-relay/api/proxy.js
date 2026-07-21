// Transparent proxy to Groq's API. Deployed on Vercel, pinned to a US region
// (see ../vercel.json) so Groq — which geo-blocks Hong Kong / China datacenter
// IPs with a 403 — sees an allowed US IP instead.
//
// vercel.json rewrites /api/openai/<path> here with ?upstream=openai/<path>,
// so this forwards to https://api.groq.com/openai/<path>. No secret is stored:
// the caller's Authorization header (the Groq key) is passed straight through.
module.exports = async (req, res) => {
  try {
    // Path to hit on api.groq.com, from the rewrite (fallback: parse the URL).
    let upstream = (req.query && req.query.upstream) || '';
    if (!upstream) {
      upstream = (req.url || '').split('?')[0].replace(/^\/api\//, '');
    }
    upstream = String(upstream).replace(/^\/+/, '');
    const target = 'https://api.groq.com/' + upstream;

    const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
    if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'];

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = typeof req.body === 'string' ? req.body
           : req.body != null ? JSON.stringify(req.body) : undefined;
    }

    const upstreamRes = await fetch(target, { method: req.method, headers, body });
    const text = await upstreamRes.text();
    res.status(upstreamRes.status);
    res.setHeader('content-type', upstreamRes.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: { message: 'groq relay error: ' + e.message } });
  }
};
