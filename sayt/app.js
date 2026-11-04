// «Dashboard Ozon» — страница. Данные: /data.json (собирает GitHub каждое утро), настройки: /api/nastroyki.
(function () {
"use strict";
const IK = window.IK || {};
const $ = s => document.querySelector(s);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MES = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const MES_I = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MK = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
const DN = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
const dt = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const dDlinno = s => { const d = dt(s); return `${d.getUTCDate()} ${MES[d.getUTCMonth()]}, ${DN[d.getUTCDay()]}`; };
const dKor = s => { const d = dt(s); return `${d.getUTCDate()} ${MK[d.getUTCMonth()]}`; };
const rub = v => v == null || isNaN(v) ? "—" : (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("ru-RU") + " ₽";
const tys = v => (v < 0 ? "−" : "") + (Math.abs(v) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: Math.abs(v) >= 100000 ? 0 : 1 }) + " тыс";
const pct = (v, z = 0) => v == null || !isFinite(v) ? "—" : (v * 100).toLocaleString("ru-RU", { maximumFractionDigits: z, minimumFractionDigits: z }) + " %";
const sht = v => Math.round(v).toLocaleString("ru-RU");
const zn = v => v < 0 ? "minus" : "plus";
const ik = n => IK[n] || "";

let D = null, ST = { period: "den", den: null };
const RAZDELY = [["obzor", "Дашборд", "layout-dashboard", "Дашборд"], ["fakt", "Фактическая прибыль / убыток", "file-text", "Прибыль / убыток"],
  ["tovary", "Товары", "boxes", "Товары"], ["nastroyki", "Настройки", "settings", "Настройки"]];

function soob(t, osh) { const e = $("#soob"); e.textContent = t; e.className = "soob" + (osh ? " osh" : ""); e.style.display = "block"; clearTimeout(soob.t); soob.t = setTimeout(() => e.style.display = "none", 4200); }

// ── каркас ────────────────────────────────────────────────────────────────────
function karkas() {
  document.querySelectorAll("[data-ik]").forEach(e => e.innerHTML = ik(e.dataset.ik));
  const tochka = D && D.bez_zakupki && D.bez_zakupki.length;
  const ssylki = kor => RAZDELY.map(([id, t, i, k]) => `<a href="#${id}" data-r="${id}">${ik(i)}<span>${kor ? k : t}</span>${id === "nastroyki" && tochka ? '<i class="tochka"></i>' : ""}</a>`).join("");
  $("#nav").innerHTML = ssylki(false); $("#tabbar").innerHTML = ssylki(true);
  const mag = esc(D.magazin || "Мой магазин");
  $("#chip-m").innerHTML = `<b>OZON</b>${mag}`;
  const ob = D.obnovleno ? new Date(D.obnovleno) : null;
  $("#niz").innerHTML = `<b>${mag}</b>Обновлено ${ob ? ob.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "—"}<br><a href="/vyhod">${ik("log-out").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} Выйти</a>`;
  $("#foot").textContent = `Dashboard Ozon ${D.versiya || ""} · данные Ozon Seller API`;
}

function razdel() {
  const r = (location.hash || "#obzor").slice(1).split("/")[0];
  document.querySelectorAll("[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === r));
  ({ obzor, fakt, tovary, nastroyki }[r] || obzor)();
  window.scrollTo({ top: 0 });
}

// ── сводка за дни ─────────────────────────────────────────────────────────────
const POLYA = ["zakazy", "prodazhi", "vyruchka", "komissiya", "logistika", "nalog", "zakupka", "reklama", "mp1", "obshchie", "opr", "mp2", "chistymi"];
function svod(dni) {
  const s = Object.fromEntries(POLYA.map(k => [k, 0])); s.tovary = {}; s.dney = dni.length;
  for (const d of dni) {
    for (const k of POLYA) s[k] += d[k] || 0;
    for (const [a, t] of Object.entries(d.tovary || {})) {
      const z = s.tovary[a] || (s.tovary[a] = { zakazy: 0, prodazhi: 0, vyruchka: 0, reklama: 0, mp1: 0, mp2: 0, komissiya: 0, logistika: 0, nalog: 0, zakupka: 0 });
      for (const k in z) z[k] += t[k] || 0;
    }
  }
  return s;
}
function vybrannye() {
  const dni = D.dni; if (!dni.length) return { dni: [], podpis: "" };
  const posl = dni.length - 1;
  if (ST.period === "den") {
    const i = ST.den == null ? posl : ST.den;
    return { dni: [dni[i]], podpis: (i === posl ? "Вчера · " : "") + dDlinno(dni[i].d), i };
  }
  if (ST.period === "7") return { dni: dni.slice(-7), podpis: `7 дней · ${dKor(dni[Math.max(0, posl - 6)].d)} — ${dKor(dni[posl].d)}` };
  if (ST.period === "30") return { dni: dni.slice(-30), podpis: `30 дней · ${dKor(dni[Math.max(0, posl - 29)].d)} — ${dKor(dni[posl].d)}` };
  const m = dni[posl].d.slice(0, 7);
  const v = dni.filter(d => d.d.startsWith(m));
  return { dni: v, podpis: `${MES_I[+m.slice(5) - 1]} · ${v.length} ${v.length === 1 ? "день" : v.length < 5 ? "дня" : "дней"}` };
}

// ── «Обзор» ───────────────────────────────────────────────────────────────────
function obzor() {
  if (!D.dni.length) { $("#ekran").innerHTML = `<div class="card"><div class="pusto-blok">Данных пока нет — первый сбор ещё идёт. Загляните через полчаса.</div></div>`; return; }
  const V = vybrannye(), S = svod(V.dni), dni = D.dni;
  const periody = [["den", "День"], ["7", "7 дней"], ["mes", "Месяц"], ["30", "30 дней"]];
  const iDen = V.i ?? dni.length - 1;
  let delta = "";
  if (ST.period === "den") {
    const pr = dni.slice(Math.max(0, iDen - 7), iDen); const sr = pr.reduce((s, d) => s + d.chistymi, 0) / (pr.length || 1);
    const r = S.chistymi - sr;
    if (pr.length) delta = `<div class="delta${r >= 0 ? " up" : ""}">${r < 0 ? "↓" : "↑"} ${rub(Math.abs(r))} <span>к среднему за прошлую неделю</span></div>`;
  } else {
    delta = `<div class="delta${S.chistymi >= 0 ? " up" : ""}">${rub(S.chistymi / S.dney)} <span>в среднем за день</span></div>`;
  }
  const ozon = S.komissiya + S.logistika;
  const vnim = D.bez_zakupki && D.bez_zakupki.length ? `<div class="vnim"><div class="ico">${ik("triangle-alert")}</div><div><b>Укажите закупку для ${D.bez_zakupki.length} ${D.bez_zakupki.length === 1 ? "товара" : "товаров"}</b>
    <span>Без неё прибыль по ним завышена: закупка считается нулём.</span></div><a class="knopka malaya kn2" href="#nastroyki">Открыть настройки</a></div>` : "";
  // месяц выбранного дня: с 1-го числа по выбранный день; прошедший месяц — с итогом, текущий — с прогнозом
  const dKon = V.dni[V.dni.length - 1].d, mes = dKon.slice(0, 7), vesMes = dni.filter(d => d.d.startsWith(mes));
  const dm = vesMes.filter(d => d.d <= dKon), uzhe = dm.reduce((s, d) => s + d.chistymi, 0);
  const vMes = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5), 0)).getUTCDate();
  const proshel = mes < dni[dni.length - 1].d.slice(0, 7) && vesMes.length >= vMes;
  const itogMes = vesMes.reduce((s, d) => s + d.chistymi, 0);
  $("#ekran").innerHTML = `
  <div class="shapka"><div><h1>Дашборд</h1><div class="pod">${esc(V.podpis)}</div></div>
    <div class="ryad"><label class="kalendar" title="Выбрать дату">${ik("calendar")}<span>Выбрать дату</span>
      <input type="date" id="vybor-daty" min="${dni[0].d}" max="${dni[dni.length - 1].d}" value="${dni[iDen].d}"></label>
    ${ST.period === "den" ? `<div class="den-nav"><button class="kn" id="pred" ${iDen <= 0 ? "disabled" : ""} aria-label="Предыдущий день">${ik("chevron-left")}</button>
      <button class="kn" id="sled" ${iDen >= dni.length - 1 ? "disabled" : ""} aria-label="Следующий день">${ik("chevron-right")}</button></div>` : ""}
    <div class="seg">${periody.map(([k, t]) => `<button data-p="${k}" class="${ST.period === k ? "on" : ""}">${t}</button>`).join("")}</div></div></div>
  ${vnim}
  <div class="grid">
    <section class="card s7"><div class="hd"><div class="ico">${ik("wallet")}</div><div><h2>Чистая прибыль</h2><div class="s">после Ozon, закупки, налога, рекламы и своих расходов</div></div></div>
      <div class="big ${zn(S.chistymi)}">${rub(S.chistymi)}</div>${delta}
      <div class="kpis">
        <div class="kpi"><div class="ico">${ik("shopping-cart")}</div><div><div class="l">Заказы</div><div class="n">${sht(S.zakazy)}</div><div class="p">≈ ${sht(S.prodazhi)} выкупят</div></div></div>
        <div class="kpi g"><div class="ico">${ik("coins")}</div><div><div class="l">Выручка</div><div class="n">${rub(S.vyruchka)}</div><div class="p">с выкупленных</div></div></div>
        <div class="kpi v"><div class="ico">${ik("megaphone")}</div><div><div class="l">Реклама</div><div class="n">${rub(S.reklama)}</div><div class="p">ДРР ${pct(S.reklama / S.vyruchka, 1)}</div></div></div>
        <div class="kpi o"><div class="ico">${ik("landmark")}</div><div><div class="l">Налог</div><div class="n">${rub(S.nalog)}</div><div class="p">${pct(S.nalog / S.vyruchka, 1)} выручки</div></div></div>
      </div></section>
    <section class="card s5 o"><div class="hd"><div class="ico">${ik("chart-pie")}</div><div><h2>Куда ушли деньги</h2><div class="s">из ${rub(S.vyruchka)} выручки</div></div></div>
      <div class="donut-box"><div class="donut" id="donut"></div><div class="leg" id="leg"></div></div>
      <div class="itog"><span>Осталось чистыми</span><b class="${zn(S.chistymi)}">${rub(S.chistymi)}</b></div></section>
    <section class="card s7"><div class="hd"><div class="ico">${ik("trending-up")}</div><div><h2>Выручка по дням</h2><div class="s">последние 30 дней · наведите на график</div></div></div><div class="chart" id="g-vyr"></div></section>
    <section class="card s5 v"><div class="hd"><div class="ico">${ik("calendar")}</div><div><h2>${MES_I[+mes.slice(5) - 1]}</h2><div class="s">прибыль с начала месяца</div></div></div>
      <div class="mes"><div><div class="l">По ${dKor(dKon)}</div><div class="n ${zn(uzhe)}">${rub(uzhe)}</div><div class="mut">за ${dm.length} ${dm.length === 1 ? "день" : dm.length < 5 ? "дня" : "дней"}</div></div>
      ${proshel ? `<div><div class="l">Итог месяца</div><div class="n ${zn(itogMes)}">${rub(itogMes)}</div><div class="mut">за все ${vMes} дней</div></div>`
        : `<div><div class="l">Прогноз на месяц</div><div class="n ${zn(uzhe)}">${rub(uzhe / dm.length * vMes)}</div><div class="mut">если темп сохранится</div></div>`}</div>
      <div class="bar"><i style="width:${Math.round(dm.length / vMes * 100)}%"></i></div><div class="mut">${dm.length} из ${vMes} дней месяца</div></section>
    <section class="card s12 g"><div class="hd"><div class="ico">${ik("chart-column")}</div><div><h2>Прибыль по дням</h2><div class="s">последние 30 дней · нажмите на столбик, чтобы открыть день</div></div></div><div class="chart" id="g-st"></div></section>
    <section class="card s12"><div class="hd"><div class="ico">${ik("package")}</div><div><h2>Товары</h2><div class="s">${esc(V.podpis)} · линия — прибыль за 14 дней</div></div></div><div id="t-tov"></div></section>
  </div>`;
  document.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { ST.period = b.dataset.p; ST.den = null; obzor(); });
  const vd = $("#vybor-daty");
  vd.onclick = () => { try { vd.showPicker(); } catch (e) {} };
  vd.onchange = () => {
    const i = dni.findIndex(d => d.d === vd.value);
    if (i < 0) { soob("За эту дату данных нет — выберите день с " + dKor(dni[0].d) + " по " + dKor(dni[dni.length - 1].d), true); return; }
    ST.period = "den"; ST.den = i; obzor();
  };
  if ($("#pred")) { $("#pred").onclick = () => { ST.den = iDen - 1; obzor(); }; $("#sled").onclick = () => { ST.den = iDen + 1; obzor(); }; }
  koltso(S); tablicaTovarov(S, V);
  const ris = () => { grafikVyruchki(V); stolbiki(V); sparki(); };
  ris(); window.onresize = () => { clearTimeout(ris.t); ris.t = setTimeout(ris, 120); };
}

function koltso(S) {
  // не больше 6 цветов — столько проверено на различимость; общие расходы Ozon — вместе с услугами
  const sost = [["Ozon: комиссия", S.komissiya, "--do-blue"], ["Ozon: логистика и услуги", S.logistika + S.obshchie, "--do-cyan"], ["Закупка", S.zakupka, "--do-amber"],
    ["Налог", S.nalog, "--do-teal"], ["Реклама", S.reklama, "--do-violet"]];
  if (S.opr) sost.push(["Свои расходы", S.opr, "--do-pink"]);
  const vsego = sost.reduce((s, x) => s + Math.max(0, x[1]), 0) || 1, R = 68, W = 17, C = 84, L = 2 * Math.PI * R, gap = 3;
  let off = 0, g = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="${W}"/>`;
  sost.forEach(([n, x, c]) => { if (x <= 0) return; const len = x / vsego * L, dl = Math.max(.6, len - gap);
    g += `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${css(c)}" stroke-width="${W}" stroke-dasharray="${dl} ${L - dl}" stroke-dashoffset="${-off}" transform="rotate(-90 ${C} ${C})" style="filter:drop-shadow(0 0 6px ${css(c)}88)"><title>${n}: ${rub(x)}</title></circle>`; off += len; });
  $("#donut").innerHTML = `<svg width="168" height="168" viewBox="0 0 168 168">${g}</svg><div class="ctr"><b>${tys(vsego)}</b><span>расходов</span></div>`;
  $("#leg").innerHTML = sost.map(([n, x, c]) => `<div><i style="background:${css(c)};box-shadow:0 0 8px ${css(c)}"></i><span>${n}</span><span><em>${rub(x)}</em><small>${S.vyruchka ? Math.round(x / S.vyruchka * 100) + "%" : ""}</small></span></div>`).join("");
}

function podskazka(box, html, x, W) {
  let t = box.querySelector(".tip"); if (!t) { t = document.createElement("div"); t.className = "tip"; box.appendChild(t); }
  t.hidden = false; t.innerHTML = html; const tw = t.offsetWidth; t.style.left = Math.min(Math.max(0, x - tw / 2), W - tw) + "px"; t.style.top = "-12px";
}
function osX(dni, X, H, g) {
  const n = dni.length, shag = n > 20 ? 7 : n > 10 ? 3 : 1;
  dni.forEach((d, i) => { if ((n - 1 - i) % shag === 0) g.push(`<text x="${X(i)}" y="${H - 5}" text-anchor="${i === n - 1 ? "end" : i === 0 ? "start" : "middle"}" class="os">${dKor(d.d)}</text>`); });
}

function grafikVyruchki(V) {
  const box = $("#g-vyr"); if (!box) return;
  const dni = D.dni.slice(-30), W = box.clientWidth, H = 210, pl = 64, pr = 12, pt = 24, xb = 22, ph = H - pt - xb;
  const y = dni.map(d => d.vyruchka), hi = Math.max(1, ...y) * 1.1, sc = q => pt + (hi - q) / hi * ph, X = i => pl + (dni.length === 1 ? 0 : i / (dni.length - 1)) * (W - pl - pr);
  const pts = y.map((q, i) => [X(i), sc(q)]);
  const put = pts.map((p, i) => { if (!i) return `M${p[0]},${p[1]}`; const a = pts[i - 1], cx = (a[0] + p[0]) / 2; return `C${cx},${a[1]} ${cx},${p[1]} ${p[0]},${p[1]}`; }).join("");
  const g = [`<defs><linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4F8CFF" stop-opacity=".45"/><stop offset="1" stop-color="#4F8CFF" stop-opacity="0"/></linearGradient>
    <filter id="sv" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`];
  const vyb = new Set(V.dni.map(d => d.d)), i0 = dni.findIndex(d => vyb.has(d.d)), i1 = dni.map(d => vyb.has(d.d)).lastIndexOf(true);
  if (i0 >= 0 && V.dni.length < 30) g.push(`<rect x="${X(i0) - (i0 === i1 ? 6 : 0)}" y="${pt}" width="${Math.max(12, X(i1) - X(i0))}" height="${ph}" rx="8" fill="rgba(79,140,255,.08)" stroke="rgba(120,170,255,.25)"/>`);
  [hi / 1.1, hi / 2.2, 0].forEach(t => g.push(`<line x1="${pl}" x2="${W - pr}" y1="${sc(t)}" y2="${sc(t)}" stroke="${css("--do-grid")}"/><text x="${pl - 10}" y="${sc(t) + 4}" text-anchor="end" class="os">${t ? tys(t) : "0"}</text>`));
  g.push(`<path d="${put} L${X(y.length - 1)},${sc(0)} L${X(0)},${sc(0)} Z" fill="url(#gv)"/><path d="${put}" fill="none" stroke="#6EA2FF" stroke-width="2.2" filter="url(#sv)"/>`);
  osX(dni, X, H, g);
  g.push(`<line class="kh" y1="${pt}" y2="${sc(0)}" stroke="rgba(160,190,255,.5)" visibility="hidden"/><circle class="kt" r="5" fill="#6EA2FF" stroke="${css("--do-surface")}" stroke-width="2" visibility="hidden" style="filter:drop-shadow(0 0 6px #4F8CFF)"/>`);
  box.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Выручка по дням">${g.join("")}<rect x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent"/></svg>`;
  const sv = box.querySelector("svg"), kh = sv.querySelector(".kh"), kt = sv.querySelector(".kt");
  const pok = e => { const b = sv.getBoundingClientRect(), i = Math.round(Math.min(1, Math.max(0, (e.clientX - b.left - pl) / (W - pl - pr))) * (y.length - 1)), x = X(i);
    kh.setAttribute("x1", x); kh.setAttribute("x2", x); kh.setAttribute("visibility", "visible"); kt.setAttribute("cx", x); kt.setAttribute("cy", sc(y[i])); kt.setAttribute("visibility", "visible");
    podskazka(box, `<b>${dDlinno(dni[i].d)}</b><div>${rub(y[i])}</div>${sht(dni[i].zakazy)} заказов`, x, W); };
  sv.addEventListener("pointermove", pok); sv.addEventListener("pointerdown", pok);
  sv.addEventListener("pointerleave", () => { kh.setAttribute("visibility", "hidden"); kt.setAttribute("visibility", "hidden"); const t = box.querySelector(".tip"); if (t) t.hidden = true; });
}

function stolbiki(V) {
  const box = $("#g-st"); if (!box) return;
  const dni = D.dni.slice(-30), sdvig = D.dni.length - dni.length, W = box.clientWidth, H = 210, pl = 64, pr = 8, pt = 24, xb = 22, ph = H - pt - xb;
  const q = dni.map(d => d.chistymi), hi = Math.max(0, ...q), lo = Math.min(0, ...q), sc = t => pt + (hi - t) / ((hi - lo) || 1) * ph, n = q.length, sh = (W - pl - pr) / n, bw = Math.min(16, sh - 3);
  const vyb = new Set(V.dni.map(d => d.d)), g = [];
  [hi, 0, lo].filter((t, i, a) => a.indexOf(t) === i).forEach(t => g.push(`<line x1="${pl}" x2="${W - pr}" y1="${sc(t)}" y2="${sc(t)}" stroke="${css("--do-grid")}"/><text x="${pl - 10}" y="${sc(t) + 4}" text-anchor="end" class="os">${t ? tys(t) : "0"}</text>`));
  q.forEach((t, i) => { const x = pl + i * sh + (sh - bw) / 2, top = sc(Math.max(t, 0)), bot = sc(Math.min(t, 0)), h = Math.max(1, bot - top), rr = Math.min(4, bw / 2, h), c = css(t < 0 ? "--do-minus" : "--do-plus");
    const d = t >= 0 ? `M${x},${bot}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${bot}Z` : `M${x},${top}V${bot - rr}Q${x},${bot} ${x + rr},${bot}H${x + bw - rr}Q${x + bw},${bot} ${x + bw},${bot - rr}V${top}Z`;
    const pr_ = vyb.size < 30 && !vyb.has(dni[i].d) ? .32 : 1;
    g.push(`<path d="${d}" fill="${c}" class="br" data-i="${i}" opacity="${pr_}" style="filter:drop-shadow(0 0 5px ${c}99)"/><rect x="${pl + i * sh}" y="${pt}" width="${sh}" height="${ph}" fill="transparent" class="hit" data-i="${i}" style="cursor:pointer"/>`); });
  osX(dni, i => pl + i * sh + sh / 2, H, g);
  box.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Прибыль по дням">${g.join("")}</svg>`;
  const sv = box.querySelector("svg");
  const pok = e => { const h = e.target.closest(".hit"); if (!h) return; const i = +h.dataset.i, d = dni[i];
    podskazka(box, `<b>${dDlinno(d.d)}</b><div class="${zn(d.chistymi)}">${rub(d.chistymi)}</div>${sht(d.zakazy)} заказов · реклама ${rub(d.reklama)}`, +h.getAttribute("x") + sh / 2, W); };
  sv.addEventListener("pointermove", pok);
  sv.addEventListener("click", e => { const h = e.target.closest(".hit"); if (!h) return; ST.period = "den"; ST.den = sdvig + (+h.dataset.i); obzor(); });
  sv.addEventListener("pointerleave", () => { const t = box.querySelector(".tip"); if (t) t.hidden = true; });
}

function tablicaTovarov(S, V) {
  const vse = Object.entries(S.tovary).filter(([, t]) => t.zakazy || t.reklama).sort((a, b) => b[1].vyruchka - a[1].vyruchka);
  if (!vse.length) { $("#t-tov").innerHTML = `<div class="pusto-blok">Заказов за этот период нет</div>`; return; }
  const iDo = D.dni.length - 1 - (ST.period === "den" && ST.den != null ? D.dni.length - 1 - ST.den : 0);
  const spark = a => D.dni.slice(Math.max(0, iDo - 13), iDo + 1).map(d => (d.tovary[a] || {}).mp2 || 0).join(",");
  const T = a => D.tovary[a] || { nazvanie: a, foto: "" };
  const foto = a => `<div class="foto" style="background-image:url('${esc(T(a).foto)}')"></div>`;
  $("#t-tov").innerHTML = `<div class="skroll"><table class="tab shirokaya"><thead><tr><th>Товар</th><th>Заказы</th><th>Цена</th><th>Выручка</th><th>Реклама</th><th>ДРР</th><th>Со штуки</th><th>Прибыль</th><th>14 дней</th></tr></thead><tbody>
    ${vse.map(([a, t]) => `<tr><td><div class="tov">${foto(a)}<div><div class="n">${esc(T(a).nazvanie)}</div><div class="m">${esc(a)}</div></div></div></td>
      <td>${sht(t.zakazy)}</td><td>${t.zakazy ? rub(t.vyruchka / t.prodazhi) : "—"}</td><td>${rub(t.vyruchka)}</td><td>${rub(t.reklama)}</td><td>${pct(t.reklama / t.vyruchka, 1)}</td>
      <td class="${zn(t.mp1)}">${t.prodazhi ? rub(t.mp1 / t.prodazhi) : "—"}</td><td class="${zn(t.mp2)}"><b>${rub(t.mp2)}</b></td><td><svg class="spark" data-v="${spark(a)}"></svg></td></tr>`).join("")}
    </tbody></table></div>
    <div class="tov-mob">${vse.map(([a, t]) => `<div class="tm"><div class="tov">${foto(a)}<div><div class="n">${esc(T(a).nazvanie)}</div><div class="m">${sht(t.zakazy)} заказов · ${t.zakazy ? rub(t.vyruchka / t.prodazhi) : "—"} · ДРР ${pct(t.reklama / t.vyruchka, 0)}</div></div></div>
      <div class="r"><b class="${zn(t.mp2)}">${rub(t.mp2)}</b><div class="m">${t.prodazhi ? rub(t.mp1 / t.prodazhi) : "—"} со штуки</div></div></div>`).join("")}</div>`;
}

function sparki() {
  document.querySelectorAll("svg.spark").forEach(s => {
    const q = s.dataset.v.split(",").map(Number); if (q.length < 2) return;
    const w = s.clientWidth || 84, h = 30, p = 4, lo = Math.min(0, ...q), hi = Math.max(0, ...q), Y = t => p + (hi - t) / ((hi - lo) || 1) * (h - 2 * p), X = i => p + i / (q.length - 1) * (w - 2 * p), last = q[q.length - 1], c = css(last < 0 ? "--do-minus" : "--do-plus");
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.innerHTML = `<line x1="${p}" x2="${w - p}" y1="${Y(0)}" y2="${Y(0)}" stroke="${css("--do-grid")}"/><polyline points="${q.map((t, i) => X(i) + "," + Y(t)).join(" ")}" fill="none" stroke="#9FB2E0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(q.length - 1)}" cy="${Y(last)}" r="4" fill="${c}" stroke="${css("--do-surface")}" stroke-width="2" style="filter:drop-shadow(0 0 5px ${c})"/>`;
  });
}

// ── «Факт» ────────────────────────────────────────────────────────────────────
function fakt() {
  const mesyacy = Object.keys(D.fakt || {}).sort();
  if (!mesyacy.length) { $("#ekran").innerHTML = `<div class="shapka"><h1>Фактическая прибыль / убыток</h1></div><div class="card"><div class="pusto-blok">Начисления Ozon ещё не собраны</div></div>`; return; }
  const m = ST.fm && D.fakt[ST.fm] ? ST.fm : mesyacy[mesyacy.length - 1], F = D.fakt[m];
  const nazv = k => `${MES_I[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
  const str = (t, v, pod, klass = "") => `<div class="fs ${klass}"><span>${t}${pod ? `<em>${pod}</em>` : ""}</span><b class="${klass === "ts" ? zn(v) : ""}">${rub(v)}</b></div>`;
  $("#ekran").innerHTML = `
  <div class="shapka"><div><h1>Фактическая прибыль / убыток</h1><div class="pod">реальные деньги по начислениям Ozon</div></div>
    <div class="seg">${mesyacy.slice(-6).map(k => `<button data-m="${k}" class="${k === m ? "on" : ""}">${MES_I[+k.slice(5) - 1].slice(0, 3)}</button>`).join("")}</div></div>
  <div class="grid">
    <section class="card s7 g"><div class="hd"><div class="ico">${ik("receipt")}</div><div><h2>${nazv(m)}</h2><div class="s">${F.polnyy ? "месяц закрыт" : `месяц ещё идёт · ${F.dney} дн.`}</div></div>
      ${F.polnyy ? "" : `<span class="znachok r">неполный</span>`}</div>
      <div class="big ${zn(F.chistaya)}">${rub(F.chistaya)}</div><div class="mut">чистая прибыль за ${F.polnyy ? "месяц" : "прошедшие дни"}</div>
      <div class="fakt-cep" style="margin-top:18px">
        ${str("Продажи за вычетом возвратов", F.vyruchka, "с баллами Ozon")}${str("Комиссия Ozon", F.komissiya)}${str("Логистика и услуги Ozon", F.uslugi)}
        ${str("К выплате от Ozon", F.k_vyplate, "", "ts")}${str("Реклама", F.reklama)}${str("Закупка проданного", F.sebestoimost)}
        ${str("Налог", F.nalog, "с " + rub(F.nalog_baza))}${str("Свои расходы", F.opr)}${str("Чистая прибыль", F.chistaya, "", "ts")}
      </div>
      ${F.bez_zakupki && F.bez_zakupki.length ? `<div class="vnim" style="margin:16px 0 0"><div class="ico">${ik("triangle-alert")}</div><div><b>Нет закупки: ${esc(F.bez_zakupki.join(", "))}</b><span>Закупка этих товаров посчитана нулём.</span></div></div>` : ""}
    </section>
    <section class="card s5 v"><div class="hd"><div class="ico">${ik("chart-column")}</div><div><h2>По месяцам</h2><div class="s">чистая прибыль</div></div></div><div class="chart" id="g-mes"></div>
      <p class="podskazka" style="margin:18px 0 0">Факт — по дате начисления Ozon, как в кабинете (Финансы → Начисления). «Обзор» считает по дню заказа, поэтому за одни и те же даты они не совпадают — и не должны: деньги за заказ приходят через неделю-две.</p></section>
  </div>`;
  document.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { ST.fm = b.dataset.m; fakt(); });
  const box = $("#g-mes"), W = box.clientWidth, H = 200, pl = 64, pr = 8, pt = 16, xb = 22, ph = H - pt - xb, ms = mesyacy.slice(-6), q = ms.map(k => D.fakt[k].chistaya);
  const hi = Math.max(0, ...q), lo = Math.min(0, ...q), sc = t => pt + (hi - t) / ((hi - lo) || 1) * ph, sh = (W - pl - pr) / ms.length, bw = Math.min(34, sh - 12), g = [];
  [hi, 0, lo].filter((t, i, a) => a.indexOf(t) === i).forEach(t => g.push(`<line x1="${pl}" x2="${W - pr}" y1="${sc(t)}" y2="${sc(t)}" stroke="${css("--do-grid")}"/><text x="${pl - 10}" y="${sc(t) + 4}" text-anchor="end" class="os">${t ? tys(t) : "0"}</text>`));
  q.forEach((t, i) => { const x = pl + i * sh + (sh - bw) / 2, top = sc(Math.max(t, 0)), bot = sc(Math.min(t, 0)), c = css(t < 0 ? "--do-minus" : "--do-plus");
    g.push(`<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" rx="5" fill="${c}" opacity="${ms[i] === m ? 1 : .45}" style="filter:drop-shadow(0 0 6px ${c}88)"><title>${nazv(ms[i])}: ${rub(t)}</title></rect>
      <text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle" class="os">${MES_I[+ms[i].slice(5) - 1].slice(0, 3)}</text>`); });
  box.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Чистая прибыль по месяцам">${g.join("")}</svg>`;
}

// ── «Товары»: экономика штуки за 7 дней ───────────────────────────────────────
function tovary() {
  const S = svod(D.dni.slice(-7));
  const vse = Object.entries(S.tovary).filter(([, t]) => t.prodazhi > 0).sort((a, b) => b[1].vyruchka - a[1].vyruchka);
  const akc = ["", "g", "o", "v"];
  $("#ekran").innerHTML = `<div class="shapka"><div><h1>Товары</h1><div class="pod">экономика одной штуки · последние 7 дней</div></div></div>
  <div class="grid">${vse.map(([a, t], i) => { const T = D.tovary[a] || { nazvanie: a }, p = t.prodazhi, sht1 = v => rub(v / p);
    return `<section class="card s4 ${akc[i % 4]}"><div class="tov" style="margin-bottom:16px"><div class="foto" style="width:56px;height:56px;background-image:url('${esc(T.foto || "")}')"></div>
      <div><div class="n">${esc(T.nazvanie)}</div><div class="m">${esc(a)} · ${sht(t.zakazy / 7)} заказов в день</div></div></div>
      <div class="fakt-cep">${[["Цена", t.vyruchka], ["Комиссия Ozon", -t.komissiya, pct(t.komissiya / t.vyruchka)], ["Логистика и услуги", -t.logistika], ["Налог", -t.nalog], ["Закупка", -t.zakupka]]
        .map(([n, v, x]) => `<div class="fs"><span>${n}${x ? `<em>${x}</em>` : ""}</span><b>${sht1(v)}</b></div>`).join("")}
      <div class="fs ts"><span>Со штуки до рекламы</span><b class="${zn(t.mp1)}">${sht1(t.mp1)}</b></div>
      <div class="fs"><span>Реклама на штуку<em>ДРР ${pct(t.reklama / t.vyruchka, 1)}</em></span><b>${sht1(-t.reklama)}</b></div>
      <div class="fs ts"><span>Со штуки после рекламы</span><b class="${zn(t.mp2)}">${sht1(t.mp2)}</b></div></div></section>`; }).join("") || `<div class="card s12"><div class="pusto-blok">Продаж за неделю нет</div></div>`}</div>`;
}

// ── «Настройки» ───────────────────────────────────────────────────────────────
let NS = null, SHA = null;
async function nastroyki() {
  $("#ekran").innerHTML = `<div class="shapka"><div><h1>Настройки</h1><div class="pod">сохраняются в вашу копию на GitHub, пересчёт — сам</div></div></div><div class="card"><div class="pusto-blok">Загружаю настройки…</div></div>`;
  try {
    const r = await fetch("/api/nastroyki"); const o = await r.json();
    if (!r.ok) throw new Error(o.oshibka || r.status);
    NS = o.nastroyki || { magazin: "", tovary: {}, nalog: [{ s: "2020-01-01", rezhim: "usn_dohody", usn: 0.06, nds: 0 }], opr: [], istoriya_s: null }; SHA = o.sha;
  } catch (e) {
    $("#ekran").innerHTML = `<div class="shapka"><h1>Настройки</h1></div><div class="card o"><div class="hd"><div class="ico">${ik("triangle-alert")}</div><div><h2>Настройки недоступны</h2><div class="s">${esc(e.message)}</div></div></div>
      <p class="podskazka">Страница сохраняет настройки в вашу копию на GitHub. Для этого в Cloudflare у Worker должны быть заданы GITHUB_TOKEN и GITHUB_REPO — шаг 6 инструкции.</p></div>`; return;
  }
  for (const a of Object.keys(D.tovary || {})) if (!NS.tovary[a]) NS.tovary[a] = { zakupka: null, ff: 0, vykup: null, skryt: false };
  risovatNastroyki();
}
const chislo = v => { const x = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : null; };
function risovatNastroyki() {
  const T = a => D.tovary[a] || { nazvanie: a, foto: "" };
  const tov = Object.entries(NS.tovary).sort((a, b) => (a[1].skryt - b[1].skryt) || a[0].localeCompare(b[0]));
  $("#ekran").innerHTML = `<div class="shapka"><div><h1>Настройки</h1><div class="pod">сохраняются в вашу копию на GitHub, пересчёт — сам</div></div>
    <div class="ryad"><button class="knopka" id="sohr">${ik("save")} Сохранить</button></div></div>
  <div class="grid">
    <section class="card s12"><div class="hd"><div class="ico">${ik("package")}</div><div><h2>Товары</h2><div class="s">себестоимость одной штуки с доставкой до склада Ozon</div></div></div>
      <div class="skroll"><table class="tab nastr"><thead><tr><th>Товар</th><th>Закупка, ₽</th><th>Фулфилмент, ₽</th><th>Выкуп, %</th><th>Скрыть</th></tr></thead><tbody>
      ${tov.map(([a, t]) => `<tr data-a="${esc(a)}"><td><div class="tov"><div class="foto" style="background-image:url('${esc(T(a).foto)}')"></div><div><div class="n">${esc(T(a).nazvanie)}</div><div class="m">${esc(a)}</div></div></div></td>
        <td data-l="Закупка, ₽"><input class="vvod malo ${t.zakupka == null || t.zakupka === "" ? "pusto" : ""}" data-k="zakupka" inputmode="decimal" value="${t.zakupka ?? ""}" placeholder="укажите"></td>
        <td data-l="ФФ, ₽"><input class="vvod malo" data-k="ff" inputmode="decimal" value="${t.ff ?? 0}"></td>
        <td data-l="Выкуп, %"><input class="vvod malo" data-k="vykup" inputmode="decimal" value="${t.vykup != null ? Math.round(t.vykup * 100) : ""}" placeholder="авто"></td>
        <td data-l="Скрыть"><input type="checkbox" data-k="skryt" ${t.skryt ? "checked" : ""} style="width:18px;height:18px;accent-color:#4F8CFF"></td></tr>`).join("")}
      </tbody></table></div>
      <p class="podskazka" style="margin:12px 0 0">Выкуп считается сам по статусам заказов. Значение здесь — запасное, для товаров с малым числом заказов. Пусто — 85 %.</p></section>

    <section class="card s12 o"><div class="hd"><div class="ico">${ik("landmark")}</div><div><h2>Налог</h2><div class="s">меняется с даты — история не пересчитывается по новой ставке</div></div></div>
      <div class="zag-n"><span>С даты</span><span>Система</span><span>УСН, %</span><span>НДС</span><span></span></div><div id="nalogi">${NS.nalog.map((z, i) => `<div class="stroka-n" data-i="${i}">
        <input class="vvod" type="date" data-k="s" value="${esc(z.s)}">
        <select class="vvod" data-k="rezhim"><option value="usn_dohody" ${z.rezhim !== "usn_dr" ? "selected" : ""}>УСН доходы</option><option value="usn_dr" ${z.rezhim === "usn_dr" ? "selected" : ""}>УСН доходы − расходы</option></select>
        <input class="vvod" data-k="usn" inputmode="decimal" value="${Math.round((z.usn || 0) * 1000) / 10}" title="Ставка УСН, %">
        <select class="vvod" data-k="nds">${[0, 0.05, 0.07, 0.22].map(v => `<option value="${v}" ${+(z.nds || 0) === v ? "selected" : ""}>${v ? "НДС " + v * 100 + " %" : "без НДС"}</option>`).join("")}</select>
        <button class="udal" data-ud="nalog" data-i="${i}" title="Убрать">${ik("trash-2")}</button></div>`).join("")}</div>
      <button class="knopka vtor malaya" id="plus-nalog">${ik("plus")} Ставка с новой даты</button>
      <p class="podskazka" style="margin:14px 0 0">База — продажи из отчёта Ozon, доплата банка Ozon и баллы, пришедшие деньгами. Баллы, которыми Ozon погасил свою комиссию, — не доход (письмо ФНС от 02.09.2026 № СД-35-3/11693@). НДС — внутри цены, УСН считается с суммы без НДС. Сверьте с бухгалтером.</p></section>

    <section class="card s6 v"><div class="hd"><div class="ico">${ik("wallet")}</div><div><h2>Свои расходы</h2><div class="s">зарплаты, бухгалтерия, аренда — сумма в месяц</div></div></div>
      ${(NS.opr || []).length ? `<div class="zag-o"><span>С даты</span><span>В месяц, ₽</span><span></span></div>` : ""}<div id="opr">${(NS.opr || []).map((z, i) => `<div class="stroka-o" data-i="${i}"><input class="vvod" type="date" data-k="s" value="${esc(z.s)}"><input class="vvod" data-k="summa" inputmode="decimal" value="${z.summa ?? 0}" placeholder="₽ в месяц">
        <button class="udal" data-ud="opr" data-i="${i}" title="Убрать">${ik("trash-2")}</button></div>`).join("") || `<p class="podskazka">Пока нет — прибыль считается без них.</p>`}</div>
      <button class="knopka vtor malaya" id="plus-opr">${ik("plus")} Сумма с новой даты</button></section>
    <section class="card s6"><div class="hd"><div class="ico">${ik("shopping-bag")}</div><div><h2>Магазин</h2><div class="s">название и глубина истории</div></div></div>
      <div class="pole"><label>Название магазина</label><input class="vvod" id="magazin" value="${esc(NS.magazin || "")}" maxlength="80"></div>
      <div class="pole"><label>Считать историю с</label><input class="vvod" type="date" id="istoriya" value="${esc(NS.istoriya_s || D.istoriya_s || "")}"></div>
      <p class="podskazka">Раньше этой даты данные не собираются. Новые дни подкачиваются по 120 за запуск.</p></section>

    <section class="card s12 g"><div class="hd"><div class="ico">${ik("refresh-cw")}</div><div><h2>Сбор и обновления</h2><div class="s">данные собираются каждое утро сами</div></div></div>
      <div class="ryad"><button class="knopka vtor" id="sobrat">${ik("refresh-cw")} Пересчитать сейчас</button><button class="knopka vtor" id="obnovit">${ik("download")} Обновить инструмент</button></div>
      <div id="zapuski" class="mut" style="margin-top:14px"></div></section>
  </div>`;
  const pod = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
  pod("[data-ud]", b => b.onclick = () => { sobrat(); NS[b.dataset.ud].splice(+b.dataset.i, 1); risovatNastroyki(); });
  $("#plus-nalog").onclick = () => { sobrat(); const p = NS.nalog[NS.nalog.length - 1] || { usn: 0.06, nds: 0, rezhim: "usn_dohody" }; NS.nalog.push({ ...p, s: new Date().toISOString().slice(0, 10) }); risovatNastroyki(); };
  $("#plus-opr").onclick = () => { sobrat(); (NS.opr = NS.opr || []).push({ s: new Date().toISOString().slice(0, 10), summa: 0 }); risovatNastroyki(); };
  $("#sohr").onclick = sohranit;
  $("#sobrat").onclick = () => zapusk("/api/sobrat", "Пересчёт запущен — новые цифры появятся через 3–5 минут");
  $("#obnovit").onclick = () => { if (confirm("Подтянуть свежую версию инструмента? Настройки и история не изменятся.")) zapusk("/api/obnovit", "Обновление запущено — через пару минут обновите страницу"); };
  statusZapuskov();
}
function sobrat() {
  document.querySelectorAll("tr[data-a]").forEach(r => { const t = NS.tovary[r.dataset.a], v = k => r.querySelector(`[data-k="${k}"]`);
    t.zakupka = chislo(v("zakupka").value); t.ff = chislo(v("ff").value) || 0; const vy = chislo(v("vykup").value); t.vykup = vy == null ? null : vy / 100; t.skryt = v("skryt").checked; });
  document.querySelectorAll(".stroka-n").forEach(r => { const z = NS.nalog[+r.dataset.i], v = k => r.querySelector(`[data-k="${k}"]`);
    z.s = v("s").value; z.rezhim = v("rezhim").value; z.usn = (chislo(v("usn").value) || 0) / 100; z.nds = +v("nds").value; });
  document.querySelectorAll(".stroka-o").forEach(r => { const z = NS.opr[+r.dataset.i]; z.s = r.querySelector('[data-k="s"]').value; z.summa = chislo(r.querySelector('[data-k="summa"]').value) || 0; });
  if ($("#magazin")) { NS.magazin = $("#magazin").value.trim(); NS.istoriya_s = $("#istoriya").value || null; }
}
async function sohranit() {
  sobrat(); const b = $("#sohr"); b.disabled = true;
  try {
    const r = await fetch("/api/nastroyki", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nastroyki: NS, sha: SHA }) });
    const o = await r.json(); if (!r.ok) throw new Error(o.oshibka || r.status);
    SHA = o.sha; soob("Сохранено. Пересчёт начнётся сам — новые цифры через 3–5 минут");
  } catch (e) { soob("Не сохранилось: " + e.message, true); }
  b.disabled = false;
}
async function zapusk(put, tekst) {
  try { const r = await fetch(put, { method: "POST" }); const o = await r.json(); if (!r.ok) throw new Error(o.oshibka || r.status); soob(tekst); setTimeout(statusZapuskov, 4000); }
  catch (e) { soob("Не получилось: " + e.message, true); }
}
async function statusZapuskov() {
  try { const r = await fetch("/api/status"); const o = await r.json(); if (!r.ok) return;
    const itog = z => z.status !== "completed" ? "идёт…" : z.itog === "success" ? "готово" : "ошибка";
    $("#zapuski").innerHTML = "Последние запуски: " + o.zapuski.map(z => `${esc(z.imya)} — ${itog(z)} (${new Date(z.kogda).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})`).join(" · ");
  } catch (e) {}
}

// ── старт ─────────────────────────────────────────────────────────────────────
fetch("/data.json", { cache: "no-store" }).then(r => { if (r.status === 401) { location.href = "/vhod"; throw 0; } return r.json(); })
  .then(d => { D = d; karkas(); razdel(); window.addEventListener("hashchange", razdel); })
  .catch(e => { if (e) $("#ekran").innerHTML = `<div class="card"><div class="pusto-blok">Данных пока нет — первый сбор ещё идёт или не настроены ключи Ozon (шаг 4 инструкции).</div></div>`; });
})();
