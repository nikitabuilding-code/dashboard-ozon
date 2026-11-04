"""Сбор данных из Ozon в папку dannye/. Каждый источник дописывает свою историю и не трогает чужую.

dannye/tovary.json              товары: артикул → название, SKU, фото
dannye/zakazy.json              заказы FBO по дню заказа (МСК): штук, сумма, выкуплено, отменено
dannye/nachisleniya/ГГГГ-ММ.json начисления по дням: по товарам (v d b p n k u) и по видам (для «Факта»)
dannye/reklama.json             расход рекламы по дням и товарам
dannye/komissiya.json           ставка комиссии FBO из кабинета — снимок на каждый день сбора
"""
import datetime as dt
import json
import os
from collections import defaultdict

import ozon

MSK = dt.timezone(dt.timedelta(hours=3))
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DANNYE = os.path.join(KOREN, "dannye")


def segodnya():
    return dt.datetime.now(MSK).date()


def chitat(imya, pusto=None):
    put = os.path.join(DANNYE, imya)
    try:
        with open(put, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {} if pusto is None else pusto


def pisat(imya, dannye):
    put = os.path.join(DANNYE, imya)
    os.makedirs(os.path.dirname(put), exist_ok=True)
    vrem = put + ".tmp"
    with open(vrem, "w", encoding="utf-8") as f:
        json.dump(dannye, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(vrem, put)


def _r(x):
    return float((x or {}).get("amount") or 0)


# ── Товары ────────────────────────────────────────────────────────────────────

def tovary(zhurnal):
    """Все товары кабинета (кроме архивных). Возвращает {артикул: {...}} и карту SKU → артикул."""
    ids, last = [], ""
    while True:
        o = ozon.seller("/v3/product/list", {"filter": {"visibility": "ALL"}, "last_id": last, "limit": 1000})
        res = o.get("result") or {}
        ids += [x["product_id"] for x in res.get("items") or [] if not x.get("archived")]
        last = res.get("last_id") or ""
        if not last or len(res.get("items") or []) < 1000:
            break
    vse = chitat("tovary.json")
    for i in range(0, len(ids), 100):
        o = ozon.seller("/v3/product/info/list", {"product_id": ids[i:i + 100]})
        for x in o.get("items") or []:
            skus = sorted({int(s["sku"]) for s in x.get("sources") or [] if s.get("sku")} |
                          ({int(x["sku"])} if x.get("sku") else set()))
            foto = x.get("primary_image") or ""
            if isinstance(foto, list):
                foto = foto[0] if foto else ""
            if not foto and x.get("images"):
                foto = x["images"][0]
            vse[x["offer_id"]] = {"nazvanie": x.get("name") or x["offer_id"], "sku": skus,
                                  "product_id": x.get("id"), "foto": foto}
    pisat("tovary.json", vse)
    karta = {s: a for a, t in vse.items() for s in t.get("sku") or []}
    zhurnal.append(f"товары: {len(vse)} в кабинете")
    return vse, karta


# ── Заказы FBO со статусами ──────────────────────────────────────────────────

def zakazy(zhurnal, dney=40):
    """Заказы за последние `dney` дней: статусы созревают, поэтому свежие дни перечитываются каждый раз.
    Цена дня = сумма заказов / штук — то, по чему реально заказывали (цена продавца)."""
    vse = chitat("zakazy.json")
    konec = segodnya()
    nach = konec - dt.timedelta(days=dney)
    novoe = defaultdict(lambda: defaultdict(lambda: {"vsego": 0, "summa": 0.0, "vykup": 0, "otmena": 0}))
    d = nach
    while d <= konec:
        po = min(d + dt.timedelta(days=6), konec)
        s_ = dt.datetime(d.year, d.month, d.day, tzinfo=MSK).astimezone(dt.timezone.utc)
        t_ = dt.datetime(po.year, po.month, po.day, 23, 59, 59, tzinfo=MSK).astimezone(dt.timezone.utc)
        kursor = ""
        while True:
            telo = {"dir": "ASC", "filter": {"since": s_.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                                              "to": t_.strftime("%Y-%m-%dT%H:%M:%S.999Z")},
                    "limit": 100, "offset": 0, "with": {"financial_data": False}}
            if kursor:
                telo["cursor"] = kursor
            o = ozon.seller("/v3/posting/fbo/list", telo)
            for x in o.get("postings") or []:
                den = dt.datetime.fromisoformat(x["created_at"].replace("Z", "+00:00")).astimezone(MSK).date().isoformat()
                for q in x.get("products") or []:
                    z = novoe[den][q.get("offer_id")]
                    n = int(q.get("quantity") or 1)
                    z["vsego"] += n
                    c = q.get("price")
                    z["summa"] += float((c.get("amount") if isinstance(c, dict) else c) or 0) * n
                    if x.get("status") == "delivered":
                        z["vykup"] += n
                    elif x.get("status") == "cancelled":
                        z["otmena"] += n
            kursor = o.get("cursor") or ""
            if not o.get("has_next") or not kursor:
                break
        d = po + dt.timedelta(days=1)
    for den, o in novoe.items():
        vse[den] = {a: {**z, "summa": round(z["summa"], 2)} for a, z in o.items()}
    pisat("zakazy.json", vse)
    zhurnal.append(f"заказы: перечитано {dney + 1} дней, в истории {len(vse)}")
    return vse


# ── Начисления по дням ───────────────────────────────────────────────────────

def vidy_nachisleniy():
    o = ozon.seller("/v1/finance/accrual/types", {})
    return {x["id"]: x.get("description") or x.get("name") for x in o.get("accrual_types") or []}


def razobrat_den(nachisleniya, vidy, karta):
    """Начисления одного дня → {"tovary": {артикул: v d b p n k u}, "vidy": {"группа|вид": ₽}}.
    v — цена продавца (деньги покупателя d + баллы b + доплата банка p), n — штук за вычетом
    возвратов, k — комиссия, u — услуги Ozon на товар (k и u положительные = расход).
    Группы видов — как в отчёте «Начисления» кабинета: Продажи, Возвраты, Вознаграждение Ozon,
    Услуги, Продвижение и реклама."""
    tov = defaultdict(lambda: {"v": 0.0, "d": 0.0, "b": 0.0, "p": 0.0, "n": 0.0, "k": 0.0, "u": 0.0})
    vid = defaultdict(float)
    obshchie = 0.0                      # расходы Ozon без товара (подписки, хранение…), кроме рекламы
    art = lambda sku: karta.get(int(sku), str(sku)) if sku else ""
    for x in nachisleniya:
        for p in ((x.get("posting") or {}).get("products") or []):
            a, q = art(p.get("sku")), float(p.get("quantity") or 0)
            z = tov[a]
            c = p.get("commission")
            if c:
                vozvrat = _r(c.get("sale_price")) < 0 or _r(c.get("sale_amount")) < 0
                g = "Возвраты" if vozvrat else "Продажи"
                z["n"] += -q if vozvrat else q
                z["d"] += _r(c.get("sale_price"))
                z["b"] += _r(c.get("bonus"))
                z["p"] += _r(c.get("coinvestment"))
                z["v"] += _r(c.get("sale_price")) + _r(c.get("bonus")) + _r(c.get("coinvestment"))
                kom = _r(c.get("commission") or c.get("sale_commission"))
                z["k"] -= kom
                vid[f"{g}|{'Возврат выручки' if vozvrat else 'Выручка'}"] += _r(c.get("sale_price"))
                vid[f"{g}|Баллы за скидки"] += _r(c.get("bonus"))
                vid[f"{g}|Программы партнёров"] += _r(c.get("coinvestment"))
                vid[f"Вознаграждение Ozon|{'Возврат вознаграждения' if vozvrat else 'Вознаграждение за продажу'}"] += kom
            for s in (p.get("delivery") or {}).get("services") or []:
                z["u"] -= _r(s.get("accrued"))
                vid["Услуги|" + vidy.get(s["type_id"], str(s["type_id"]))] += _r(s.get("accrued"))
        for f in ((x.get("item_fees") or {}).get("fees") or []):
            z = tov[art(f.get("sku"))]
            for ff in f.get("fees") or []:
                z["u"] -= _r(ff.get("accrued"))
                vid["Услуги|" + vidy.get(ff["type_id"], str(ff["type_id"]))] += _r(ff.get("accrued"))
        n = x.get("non_item_fee")
        if n:
            imya = vidy.get(n["type_id"], str(n["type_id"]))
            g = "Продвижение и реклама" if imya == "Оплата за клик" else "Услуги"
            vid[f"{g}|{imya}"] += _r(n.get("accrued"))
            if g == "Услуги":
                obshchie -= _r(n.get("accrued"))
        if x.get("container_fees"):
            vid["Услуги|Контейнерные начисления"] += _r(x.get("total_amount"))
            obshchie -= _r(x.get("total_amount"))
    itog = sum(_r(x.get("total_amount")) for x in nachisleniya)
    return {"tovary": {a: {k: round(v, 2) for k, v in z.items()} for a, z in tov.items()},
            "vidy": {k: round(v, 2) for k, v in vid.items() if abs(v) >= 0.005},
            "obshchie": round(obshchie, 2), "itog": round(itog, 2)}


def nachisleniya(zhurnal, karta, s, dopisyvat_dney=10, maks_novyh=120):
    """Начисления за каждый день с `s` по вчера. Последние `dopisyvat_dney` дней перечитываются:
    Ozon дописывает логистику задним числом. За один запуск — не больше `maks_novyh` новых дней
    (первый запуск с большой историей докачается за несколько дней)."""
    vidy = vidy_nachisleniy()
    vchera = segodnya() - dt.timedelta(days=1)
    svezhie = vchera - dt.timedelta(days=dopisyvat_dney)
    po_mes, novyh, d = {}, 0, dt.date.fromisoformat(s)
    while d <= vchera:
        m = d.isoformat()[:7]
        if m not in po_mes:
            po_mes[m] = chitat(f"nachisleniya/{m}.json")
        den = d.isoformat()
        if (den not in po_mes[m] or d >= svezhie) and novyh < maks_novyh:
            if novyh and novyh % 15 == 0:
                print(f"  начисления: скачано {novyh} дней, сейчас {den}…", flush=True)
            vse, last = [], None
            while True:
                telo = {"date": den}
                if last:
                    telo["last_id"] = last
                o = ozon.seller("/v1/finance/accrual/by-day", telo)
                vse += o.get("accruals") or []
                nov = o.get("last_id")
                if not o.get("accruals") or not nov or nov == last:
                    break
                last = nov
            po_mes[m][den] = razobrat_den(vse, vidy, karta)
            novyh += 1
        d += dt.timedelta(days=1)
    for m, dni in po_mes.items():
        pisat(f"nachisleniya/{m}.json", dni)
    zhurnal.append(f"начисления: обновлено дней {novyh}")
    vse = {}
    for imya in sorted(os.listdir(os.path.join(DANNYE, "nachisleniya"))):
        if imya.endswith(".json"):
            vse.update(chitat("nachisleniya/" + imya))
    return vse


# ── Реклама ───────────────────────────────────────────────────────────────────

def reklama(zhurnal, karta, zakazy_po_dnyam, s, dney=14):
    """Расход рекламы по дням и товарам из Performance API (дневная статистика кампаний).
    Кампания на один товар — расход целиком ему; на несколько — делится по заказам этих товаров
    за день; товары кампании не известны (оплата за заказ) — делится по заказам всех товаров."""
    vse = chitat("reklama.json")
    if not ozon.est_reklama():
        zhurnal.append("реклама: ключа Performance нет — реклама не учитывается")
        return vse
    kampanii = ozon.perf("/api/client/campaign").get("list") or []
    tov_kamp = {}
    for k in kampanii:
        try:
            pr = ozon.perf(f"/api/client/campaign/{k['id']}/v2/products").get("products") or []
            tov_kamp[str(k["id"])] = sorted({karta.get(int(x["sku"])) for x in pr if x.get("sku")} - {None})
        except ozon.OshibkaOzon:
            tov_kamp[str(k["id"])] = []
    konec = segodnya() - dt.timedelta(days=1)
    nach = max(dt.date.fromisoformat(s), konec - dt.timedelta(days=dney)) if vse else dt.date.fromisoformat(s)
    novoe = defaultdict(lambda: defaultdict(float))
    ids = [str(k["id"]) for k in kampanii]
    d = nach
    while d <= konec and ids:
        po = min(d + dt.timedelta(days=29), konec)
        for i in range(0, len(ids), 50):
            o = ozon.perf("/api/client/statistics/daily/json",
                          [("campaignIds", x) for x in ids[i:i + 50]] +
                          [("dateFrom", d.isoformat()), ("dateTo", po.isoformat())])
            for r in o.get("rows") or []:
                rashod = float(str(r.get("moneySpent") or "0").replace(",", ".").replace(" ", "").replace(" ", ""))
                if rashod <= 0:
                    continue
                kom = tov_kamp.get(str(r["id"])) or []
                den = r["date"][:10]
                zak = zakazy_po_dnyam.get(den) or {}
                komu = kom or [a for a in zak if a in set(karta.values())]
                ves = {a: (zak.get(a) or {}).get("vsego", 0) for a in komu}
                vsego = sum(ves.values())
                for a in komu:
                    novoe[den][a] += rashod * (ves[a] / vsego if vsego else 1 / len(komu))
                if not komu:
                    novoe[den]["_bez_tovara"] += rashod
        d = po + dt.timedelta(days=1)
    for den, o in novoe.items():
        vse[den] = {a: round(v, 2) for a, v in o.items()}
    pisat("reklama.json", vse)
    zhurnal.append(f"реклама: кампаний {len(kampanii)}, перечитано с {nach.isoformat()}")
    return vse


# ── Ставка комиссии из кабинета ───────────────────────────────────────────────

def komissiya(zhurnal, tovary_):
    """Снимок текущей ставки комиссии FBO по товарам — раз в день. По истории снимков расчёт
    сам видит, с какого дня Ozon поменял ставку (без ручных правок)."""
    vse = chitat("komissiya.json")
    ids = [t["product_id"] for t in tovary_.values() if t.get("product_id")]
    snimok, kursor = {}, ""
    while ids:
        o = ozon.seller("/v5/product/info/prices", {"filter": {"product_id": ids, "visibility": "ALL"},
                                                     "cursor": kursor, "limit": 1000})
        for x in o.get("items") or []:
            p = (x.get("commissions") or {}).get("sales_percent_fbo")
            if p:
                snimok[x["offer_id"]] = float(p) / 100
        kursor = o.get("cursor") or ""
        if not kursor:
            break
    if snimok:
        vse[segodnya().isoformat()] = snimok
        pisat("komissiya.json", vse)
    zhurnal.append(f"комиссия: снимок по {len(snimok)} товарам")
    return vse
