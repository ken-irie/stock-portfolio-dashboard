// Cloudflare Workers 用のエントリ。
// パスワードでログインさせ、ログイン済みの人にだけ画面とデータを返す。
// Supabase へは /api/db/ で中継し、キーはブラウザに渡さない。
// 必要なシークレット: APP_PASSWORD / SUPABASE_URL / SUPABASE_KEY（任意で SESSION_SECRET）

const SESSION_DAYS = 30;
const TABLE_PATH = /^(snapshots|holdings)$/;   // 中継してよいテーブル
const DB_METHODS = new Set(["GET", "POST", "DELETE"]);

const enc = new TextEncoder();

async function hmacKey(env) {
  const secret = (env.SESSION_SECRET || env.APP_PASSWORD) + "::kabu-session";
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
}

async function makeToken(env) {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(exp));
  return exp + "." + toHex(sig);
}

async function validToken(tok, env) {
  const [exp, sig] = (tok || "").split(".");
  const bytes = fromHex(sig || "");
  if (!exp || !bytes || Date.now() >= Number(exp)) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(env), bytes, enc.encode(exp));   // 定数時間で照合される
}

// 長さの違いが漏れないよう、ハッシュ同士を比べる
async function samePassword(input, expected) {
  const [a, b] = await Promise.all([input, expected].map(s => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

function getCookie(req, name) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

function redirect(url, to) {
  return Response.redirect(new URL(to, url).toString(), 302);
}

async function login(req, env) {
  let password = "";
  try { password = String((await req.json()).password || ""); } catch {}
  if (!(await samePassword(password, env.APP_PASSWORD))) return json({ error: "パスワードが違います" }, 401);
  const cookie = `sess=${await makeToken(env)}; HttpOnly; Secure; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}; SameSite=Lax`;
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}

// /api/db/<テーブル>?<クエリ> を Supabase の /rest/v1/ にそのまま中継する
async function proxyDb(req, env, url) {
  const table = url.pathname.slice("/api/db/".length);
  if (!TABLE_PATH.test(table) || !DB_METHODS.has(req.method)) return json({ error: "許可されていない操作です" }, 403);
  const headers = {
    "apikey": (env.SUPABASE_KEY || "").trim(),
    "Authorization": "Bearer " + (env.SUPABASE_KEY || "").trim(),
    "Content-Type": "application/json",
  };
  const prefer = req.headers.get("Prefer");
  if (prefer) headers["Prefer"] = prefer;
  // 設定ミスは例外で落とさず、どの値がおかしいかを返す（値そのものは出さない）
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return json({ error: "SUPABASE_URL / SUPABASE_KEY が設定されていません" }, 500);
  let base;
  try { base = new URL(env.SUPABASE_URL.trim()); } catch { return json({ error: "SUPABASE_URL がURLとして読めません" }, 500); }
  let res;
  try {
    res = await fetch(base.origin + "/rest/v1/" + table + url.search, {
      method: req.method,
      headers,
      body: req.method === "POST" ? await req.text() : undefined,
    });
  } catch (e) {
    return json({ error: "Supabaseへの接続に失敗しました: " + e.message }, 502);
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(req, env) {
    // 設定漏れのまま公開されないよう、パスワードが無ければ何も返さない
    if (!env.APP_PASSWORD) return new Response("APP_PASSWORD が設定されていません", { status: 500 });

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/login" && req.method === "POST") return login(req, env);
    if (path === "/api/logout" && req.method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": "sess=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax" });
    }

    const authed = await validToken(getCookie(req, "sess"), env);

    if (path === "/login") {
      if (authed) return redirect(url, "/");
      return env.ASSETS.fetch(new Request(new URL("/login", url)));
    }

    // ここから先はログイン必須
    if (!authed) {
      if (path.startsWith("/api/")) return json({ error: "認証が必要です" }, 401);
      return redirect(url, "/login");
    }

    if (path.startsWith("/api/db/")) return proxyDb(req, env, url);

    // ブラウザには中継先だけを教える（キーは渡さない）
    if (path === "/supabase-config.js") {
      return new Response('window.SUPABASE_CONFIG={proxy:"/api/db/"};', {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    return env.ASSETS.fetch(req);
  },
};
