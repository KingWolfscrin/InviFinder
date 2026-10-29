/**
 * Cloudflare Worker: Moxfield Proxy & Private WhatsApp Redirect
 *
 * 1. Proxy Moxfield requests (avoids CORS & Cloudflare bot protection):
 *    GET /?url=https://api2.moxfield.com/...
 *
 * 2. Private WhatsApp Redirect:
 *    GET /contact?to=Fausto&text=Hola...
 *    Redirects to https://wa.me/<private_phone>?text=... without exposing
 *    phone numbers in GitHub, cards.json, or client-side code.
 *
 * Configuration in Cloudflare Dashboard:
 * Settings -> Variables and Secrets:
 * - Either add individual secrets (PHONE_VALLHAY, PHONE_NACHO, etc.)
 * - Or add a single JSON secret: PHONES_JSON = {"Fausto": "549343...", "Nacho": "..."}
 */

const OWNER_SECRET_MAP = {
  "Fausto": "PHONE_VALLHAY",
  "Nacho": "PHONE_NACHO",
  "Guillo": "PHONE_GUILLO",
  "Angie": "PHONE_ANGIE",
  "Carmelo": "PHONE_CARMELO",
  "Licha": "PHONE_LICHA",
  "Lucho": "PHONE_LUCHO",
  "Rodrigo Deganutti": "PHONE_RODRIGO_DEGANUTTI",
  "Guille A.": "PHONE_GUILLE_A",
  "Franco Fatala": "PHONE_FRANCO_F",
  "Jona": "PHONE_JONA",
  "Ruso": "PHONE_RUSO",
  "Nicolas Deraco": "PHONE_NICO_D",
  "Nicolas Deracno": "PHONE_NICO_D",
  "Alex": "PHONE_ALEX",
  "Eze Posadas (Sta Fe)": "PHONE_EZE_POSADA",
  "Manuel Venturini (Sta Fe)": "PHONE_MANUEL_VENTURINI",
  "Bruno (Sta Fe)": "PHONE_BRUNO"
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── Endpoint: /contact ──────────────────────────────────────────────────
    if (url.pathname === '/contact' || url.pathname === '/contact/' || url.pathname === '/wa') {
      const to = url.searchParams.get('to');
      const text = url.searchParams.get('text') || '';

      if (!to) {
        return new Response(JSON.stringify({ error: "Missing 'to' parameter" }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // Lookup phone securely in Worker environment
      let phone = null;

      // 1. Check PHONES_JSON if configured
      if (env.PHONES_JSON) {
        try {
          const mapping = typeof env.PHONES_JSON === 'string' ? JSON.parse(env.PHONES_JSON) : env.PHONES_JSON;
          if (mapping[to]) phone = mapping[to];
        } catch (e) {}
      }

      // 2. Check secret mapping (PHONE_VALLHAY, etc.)
      if (!phone && OWNER_SECRET_MAP[to] && env[OWNER_SECRET_MAP[to]]) {
        phone = env[OWNER_SECRET_MAP[to]];
      }

      // 3. Fallback: normalized env key (e.g. PHONE_FAUSTO)
      if (!phone) {
        const normKey = 'PHONE_' + to.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        if (env[normKey]) phone = env[normKey];
      }

      // If phone found, redirect directly to WhatsApp
      if (phone) {
        const cleanPhone = String(phone).replace(/\D/g, '');
        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
        return Response.redirect(waUrl, 302);
      }

      // Fallback if no phone is configured for this person
      const safeTo = to.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Contacto no disponible</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f1115; color: #f0f0f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #1a1e24; border: 1px solid #2e3846; border-radius: 12px; padding: 24px; max-width: 440px; width: 100%; text-align: center; }
    h2 { margin-top: 0; color: #ff6b6b; font-size: 1.25rem; }
    p { color: #a0aec0; font-size: 0.9rem; line-height: 1.5; }
    textarea { width: 100%; height: 110px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; padding: 8px; font-family: inherit; font-size: 0.85rem; resize: none; margin: 12px 0; box-sizing: border-box; }
    button { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 10px 18px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
    button:hover { background: #2ea043; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Teléfono no configurado</h2>
    <p>No hay un número registrado en el servidor para <strong>${safeTo}</strong>.</p>
    <textarea readonly id="msg">${safeText}</textarea>
    <button onclick="navigator.clipboard.writeText(document.getElementById('msg').value); this.innerText='¡Copiado!';">📋 Copiar mensaje</button>
  </div>
</body>
</html>`;

      return new Response(html, {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ── Endpoint: Proxy Moxfield (default) ──────────────────────────────────
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      const data = await response.text();
      return new Response(data, {
        status: response.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': response.headers.get('Content-Type') || 'application/json'
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Proxy error', details: err.message }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  }
};

