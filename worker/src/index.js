/**
 * LM Retours — Proxy Worker Cloudflare v1.0
 * Service_role Supabase côté serveur uniquement
 */

const SUPA_URL  = "https://bnevyhwnjkwtxlurwnsf.supabase.co";
const SUPA_REST = `${SUPA_URL}/rest/v1`;
const SUPA_STORE= `${SUPA_URL}/storage/v1`;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Prefer, x-upsert",
};

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function b64url(str) {
  return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromb64url(str) {
  return atob(str.replace(/-/g,"+").replace(/_/g,"/"));
}

async function makeToken(payload, secret) {
  const p = b64url(JSON.stringify(payload));
  const s = await hmac(secret, p);
  return `${p}.${s}`;
}

async function verifyToken(token, secret) {
  try {
    const [p, s] = token.split(".");
    if (s !== await hmac(secret, p)) return null;
    const payload = JSON.parse(fromb64url(p));
    if (payload.exp < Date.now()/1000) return null;
    return payload;
  } catch { return null; }
}

function jsonResp(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type":"application/json" }
  });
}

async function supaProxy(table, qs, request, serviceKey) {
  const url = `${SUPA_REST}/${table}${qs}`;
  const headers = {
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const prefer = request.headers.get("Prefer");
  if (prefer) headers["Prefer"] = prefer;

  const init = { method: request.method, headers };
  if (["POST","PATCH","PUT"].includes(request.method)) {
    init.body = await request.text();
  }
  const resp = await fetch(url, init);
  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { ...CORS, "Content-Type":"application/json" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status:204, headers:CORS });

    const url  = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === "/" || path === "/health")
      return jsonResp({ ok:true, service:"lm-retours-proxy", v:"1.0.0" });

    // ── Login ────────────────────────────────────────────────────────────────
    if (path === "/api/login" && request.method === "POST") {
      const { username, password_hash } = await request.json();
      if (!username || !password_hash) return jsonResp({error:"missing"}, 400);

      const r = await fetch(
        `${SUPA_REST}/lm_users?username=eq.${encodeURIComponent(username)}&limit=1`,
        { headers:{ "apikey":env.SUPA_SERVICE_KEY, "Authorization":`Bearer ${env.SUPA_SERVICE_KEY}` } }
      );
      const rows = await r.json();
      if (!rows?.length)           return jsonResp({error:"invalid_credentials"}, 401);
      const u = rows[0];
      if (!u.is_active)            return jsonResp({error:"account_disabled"}, 403);
      if (u.password_hash !== password_hash) return jsonResp({error:"invalid_credentials"}, 401);

      const exp = Math.floor(Date.now()/1000) + 8*3600;
      const token = await makeToken(
        { userId:u.id, username:u.username, role:u.role,
          boutique:u.boutique, must_change_password:u.must_change_password, exp },
        env.SESSION_SECRET
      );
      // last_login
      await fetch(`${SUPA_REST}/lm_users?id=eq.${u.id}`, {
        method:"PATCH",
        headers:{ "apikey":env.SUPA_SERVICE_KEY, "Authorization":`Bearer ${env.SUPA_SERVICE_KEY}`, "Content-Type":"application/json" },
        body: JSON.stringify({ last_login: new Date().toISOString() })
      });

      return jsonResp({ token, user:{ id:u.id, username:u.username,
        role:u.role, boutique:u.boutique, must_change_password:u.must_change_password } });
    }

    // ── Routes protégées ─────────────────────────────────────────────────────
    if (path.startsWith("/api/")) {
      const auth  = request.headers.get("Authorization") || "";
      const token = auth.replace("Bearer ","").trim();
      const sess  = token ? await verifyToken(token, env.SESSION_SECRET) : null;
      if (!sess) return jsonResp({error:"unauthorized"}, 401);

      // Valider session
      if (path === "/api/session")
        return jsonResp({ valid:true, session:sess });

      // Proxy DB
      if (path.startsWith("/api/db/")) {
        const table = path.slice("/api/db/".length);
        return supaProxy(table, url.search, request, env.SUPA_SERVICE_KEY);
      }

      // Upload Storage
      if (path === "/api/storage/upload" && request.method === "POST") {
        const form   = await request.formData();
        const file   = form.get("file");
        const opath  = form.get("path");
        if (!file || !opath) return jsonResp({error:"missing"}, 400);
        const r = await fetch(`${SUPA_STORE}/object/fiche-photos/${opath}`, {
          method:"POST",
          headers:{ "apikey":env.SUPA_SERVICE_KEY, "Authorization":`Bearer ${env.SUPA_SERVICE_KEY}`,
                    "Content-Type":file.type },
          body: await file.arrayBuffer()
        });
        return jsonResp(await r.json(), r.status);
      }
    }

    return jsonResp({error:"not found"}, 404);
  }
};
