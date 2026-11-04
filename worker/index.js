// «Dashboard Ozon» — привратник на Cloudflare Workers.
// Пускает к странице только по паролю (PAROL), хранит вход в подписанной куке на 30 дней,
// отдаёт файлы из sayt/ и сохраняет настройки в GitHub пользователя.
// Переменные Worker: PAROL (секрет), GITHUB_TOKEN (секрет: доступ к своей копии — Contents и Actions
// на чтение и запись), GITHUB_REPO (обычная: «логин/имя-копии»).

const KUKA = "chistymi";
const SROK = 30 * 24 * 3600;

const enc = new TextEncoder();
async function podpis(env, tekst) {
  const k = await crypto.subtle.importKey("raw", enc.encode("chistymi:" + env.PAROL), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(tekst));
  return btoa(String.fromCharCode(...new Uint8Array(s))).replace(/[+/=]/g, c => ({ "+": "-", "/": "_", "=": "" }[c]));
}
function ravno(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function vhodVeren(req, env) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(KUKA + "=([^;]+)"));
  if (!m) return false;
  const [do_, sig] = decodeURIComponent(m[1]).split(".");
  if (!do_ || !sig || Date.now() / 1000 > +do_) return false;
  return ravno(sig, await podpis(env, do_));
}
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// ── GitHub ────────────────────────────────────────────────────────────────────
async function gh(env, put, metod = "GET", telo) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${put}`, {
    method: metod,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
      "User-Agent": "dashboard-ozon", "X-GitHub-Api-Version": "2022-11-28", ...(telo ? { "Content-Type": "application/json" } : {}) },
    body: telo ? JSON.stringify(telo) : undefined,
  });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) {}
  return { ok: r.ok, status: r.status, d };
}
const b64v = s => btoa(String.fromCharCode(...enc.encode(s)));
const b64iz = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));

function proverit(n) {
  // Возвращает текст ошибки или null. Пределы — от опечаток, а не от хозяина.
  const chislo = (v, ot, do_) => v === null || v === "" || (typeof v === "number" && isFinite(v) && v >= ot && v <= do_);
  const data = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!n || typeof n !== "object") return "нет настроек";
  if (typeof n.magazin !== "string" || n.magazin.length > 80) return "название магазина";
  for (const [a, t] of Object.entries(n.tovary || {})) {
    if (!chislo(t.zakupka, 0, 1e6)) return `закупка «${a}»`;
    if (!chislo(t.ff ?? 0, 0, 1e5)) return `фулфилмент «${a}»`;
    if (!chislo(t.vykup, 0.05, 1)) return `выкуп «${a}» (от 0,05 до 1)`;
  }
  for (const z of n.nalog || []) {
    if (!data(z.s)) return "дата налога";
    if (!["usn_dohody", "usn_dr"].includes(z.rezhim)) return "система налога";
    if (!chislo(z.usn, 0, 0.2) || !chislo(z.nds ?? 0, 0, 0.25)) return "ставка налога";
  }
  for (const z of n.opr || []) if (!data(z.s) || !chislo(z.summa, 0, 1e8)) return "свои расходы";
  if (n.istoriya_s && !data(n.istoriya_s)) return "дата начала истории";
  return null;
}

async function api(req, env, put) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO)
    return json({ oshibka: "Не задан доступ к GitHub (GITHUB_TOKEN и GITHUB_REPO) — см. инструкцию, шаг «Настройки»." }, 503);
  if (put === "/api/nastroyki" && req.method === "GET") {
    const r = await gh(env, "/contents/nastroyki.json");
    if (r.status === 404) return json({ nastroyki: null, sha: null });
    if (!r.ok) return json({ oshibka: `GitHub ответил ${r.status}` }, 502);
    return json({ nastroyki: JSON.parse(b64iz(r.d.content)), sha: r.d.sha });
  }
  if (put === "/api/nastroyki" && req.method === "POST") {
    const { nastroyki, sha } = await req.json();
    const o = proverit(nastroyki);
    if (o) return json({ oshibka: "Проверьте поле: " + o }, 400);
    const r = await gh(env, "/contents/nastroyki.json", "PUT", {
      message: "Настройки изменены на странице", ...(sha ? { sha } : {}),
      content: b64v(JSON.stringify(nastroyki, null, 2) + "\n") });
    if (r.status === 409) return json({ oshibka: "Настройки только что изменились в другом окне — обновите страницу." }, 409);
    if (!r.ok) return json({ oshibka: `GitHub ответил ${r.status}` }, 502);
    await gh(env, "/actions/workflows/sbor.yml/dispatches", "POST", { ref: "main" });
    return json({ ok: true, sha: r.d.content.sha });
  }
  if (put === "/api/sobrat" && req.method === "POST") {
    const r = await gh(env, "/actions/workflows/sbor.yml/dispatches", "POST", { ref: "main" });
    return json(r.ok ? { ok: true } : { oshibka: `GitHub ответил ${r.status}` }, r.ok ? 200 : 502);
  }
  if (put === "/api/obnovit" && req.method === "POST") {
    const r = await gh(env, "/actions/workflows/obnovit.yml/dispatches", "POST", { ref: "main" });
    return json(r.ok ? { ok: true } : { oshibka: `GitHub ответил ${r.status}` }, r.ok ? 200 : 502);
  }
  if (put === "/api/status") {
    const r = await gh(env, "/actions/runs?per_page=5");
    if (!r.ok) return json({ oshibka: `GitHub ответил ${r.status}` }, 502);
    return json({ zapuski: (r.d.workflow_runs || []).map(x => ({ imya: x.name, status: x.status, itog: x.conclusion, kogda: x.created_at })) });
  }
  return json({ oshibka: "нет такого адреса" }, 404);
}

// ── Вход ──────────────────────────────────────────────────────────────────────
function stranicaVhoda(oshibka) {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Ozon — вход</title><link rel="stylesheet" href="/vhod.css"></head><body>
<form method="post" action="/vhod" class="vhod"><div class="mark"></div><h1>Dashboard Ozon</h1><p>Прибыль вашего магазина</p>
<input type="password" name="parol" placeholder="Пароль" autofocus autocomplete="current-password" required>
${oshibka ? `<div class="osh">${oshibka}</div>` : ""}<button>Войти</button></form></body></html>`,
    { status: oshibka ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.PAROL) return new Response("Задайте пароль: переменная PAROL в настройках Worker (см. инструкцию).", { status: 503 });
    if (url.pathname === "/vhod.css" || url.pathname.startsWith("/shrifty/")) return env.ASSETS.fetch(req);
    if (url.pathname === "/vhod" && req.method === "POST") {
      const f = await req.formData();
      if (!ravno(String(f.get("parol") || ""), env.PAROL)) {
        await new Promise(r => setTimeout(r, 1200));          // перебор пароля — медленно
        return stranicaVhoda("Неверный пароль");
      }
      const do_ = String(Math.floor(Date.now() / 1000) + SROK);
      return new Response(null, { status: 303, headers: { Location: "/",
        "Set-Cookie": `${KUKA}=${encodeURIComponent(do_ + "." + await podpis(env, do_))}; Max-Age=${SROK}; Path=/; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (url.pathname === "/vyhod")
      return new Response(null, { status: 303, headers: { Location: "/vhod", "Set-Cookie": `${KUKA}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` } });
    if (!(await vhodVeren(req, env))) {
      if (url.pathname.startsWith("/api/") || url.pathname.endsWith(".json")) return json({ oshibka: "нужен вход" }, 401);
      return url.pathname === "/vhod" ? stranicaVhoda() : Response.redirect(url.origin + "/vhod", 303);
    }
    if (url.pathname === "/vhod") return Response.redirect(url.origin + "/", 303);
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST" && req.headers.get("Origin") !== url.origin) return json({ oshibka: "чужой источник" }, 403);
      return api(req, env, url.pathname);
    }
    const r = await env.ASSETS.fetch(req);
    const h = new Headers(r.headers);
    h.set("Cache-Control", url.pathname.endsWith(".json") || url.pathname === "/" ? "no-store" : "public, max-age=3600");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    return new Response(r.body, { status: r.status, headers: h });
  },
};
