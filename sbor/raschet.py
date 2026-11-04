"""Расчёт «Dashboard Ozon»: прибыль отработавшего дня (прогноз по заказам) и факт по начислениям Ozon.

Логика дня — как у Дашборда автора курса, перенесённая на Ozon:
  продажи = заказы × выкуп;  выручка = продажи × цена дня;
  МП1 = выручка − комиссия − логистика и услуги − налог − закупка − фулфилмент;
  МП2 = МП1 − реклама − общие расходы Ozon;  Чистая прибыль = МП2 − свои расходы (зарплаты, бухгалтерия…).
Ставки берутся из реальных начислений Ozon за последние 7 дней (мало продаж — за 30), выкуп — по
статусам заказов, которые уже успели доехать. Пусто ≠ ноль: чего нет — то не придумываем.
"""
import calendar
import datetime as dt
from collections import defaultdict

OKNO_DNEY = 7                # окно для комиссии, логистики и доли налоговой базы
OKNO_DLINNOE = 30            # если за 7 дней меньше MIN_SHT продаж
MIN_SHT = 10
KOMISSIYA_RAZNICA = 0.02     # ставка кабинета разошлась с окном больше чем на 2 п.п. — верим кабинету
VYKUP_OTSTUP = 5             # заказы моложе 5 дней ещё в пути
VYKUP_OKNO = 7
VYKUP_NORMA = 100            # набираем столько созревших заказов, расширяя окно по неделе
VYKUP_MIN = 20               # меньше — выкуп из настроек
VYKUP_PO_UMOLCHANIYU = 0.85


def po_date(spisok, den, klyuch="s"):
    """Запись, действующая на дату, из списка [{"s": "ГГГГ-ММ-ДД", ...}] (последняя с s ≤ den)."""
    tek = None
    for z in sorted(spisok or [], key=lambda z: z[klyuch]):
        if z[klyuch] <= den:
            tek = z
    return tek


def nds_dolya(z):
    """Доля НДС внутри цены: 5 % → 5/105."""
    n = float((z or {}).get("nds") or 0)
    return n / (1 + n)


def nalog_baza(t):
    """Налоговая база из сумм начислений: деньги покупателя + доплата банка Ozon + баллы, выплаченные
    деньгами (баллы, которыми Ozon погасил свою комиссию, — не доход: письмо ФНС от 02.09.2026
    № СД-35-3/11693@). Выплаченные баллы Ozon отдельно не отдаёт — берём баллы сверх комиссии."""
    return t["d"] + t["p"] + max(0.0, t["b"] - t["k"])


def nalog_rub(z, baza, rashody):
    """Налог в рублях по записи настроек. baza — доход по правилу выше, rashody — расходы для
    «доходы минус расходы» (комиссия, логистика, закупка, реклама)."""
    if not z:
        return 0.0
    n = nds_dolya(z)
    nds = baza * n
    if z.get("rezhim") == "usn_dr":
        return nds + float(z.get("usn") or 0) * max(0.0, baza - nds - rashody)
    return nds + float(z.get("usn") or 0) * (baza - nds)


def opr_v_den(nastroyki, den):
    z = po_date(nastroyki.get("opr"), den)
    d = dt.date.fromisoformat(den)
    return float((z or {}).get("summa") or 0) / calendar.monthrange(d.year, d.month)[1]


# ── Ставки дня ────────────────────────────────────────────────────────────────

def _summa_okna(nach, offer, d0, dney):
    t = {"v": 0.0, "d": 0.0, "b": 0.0, "p": 0.0, "n": 0.0, "k": 0.0, "u": 0.0}
    for i in range(1, dney + 1):
        z = ((nach.get((d0 - dt.timedelta(days=i)).isoformat()) or {}).get("tovary") or {}).get(offer) or {}
        for k in t:
            t[k] += z.get(k, 0) or 0
    return t


def stavka_kabineta(snimki, offer, den):
    """Ставка комиссии из ближайшего снимка кабинета не позже дня (снимки копятся с первого запуска)."""
    luchshiy = None
    for d in sorted(snimki):
        if d <= den and offer in snimki[d]:
            luchshiy = snimki[d][offer]
    return luchshiy


def stavki(den, offer, nach, zakazy, snimki):
    d0 = dt.date.fromisoformat(den)
    t = _summa_okna(nach, offer, d0, OKNO_DNEY)
    if t["n"] < MIN_SHT:
        t = _summa_okna(nach, offer, d0, OKNO_DLINNOE)
    out = {"komissiya": None, "logistika": None, "dolya_bazy": None, "vykup": None, "istochnik_komissii": None}
    if t["n"] >= MIN_SHT and t["v"] > 0:
        out.update(komissiya=t["k"] / t["v"], logistika=t["u"] / t["n"], dolya_bazy=nalog_baza(t) / t["v"],
                   istochnik_komissii="начисления")
    kab = stavka_kabineta(snimki, offer, den)
    if kab and (out["komissiya"] is None or abs(kab - out["komissiya"]) > KOMISSIYA_RAZNICA):
        out["komissiya"], out["istochnik_komissii"] = kab, "кабинет"
    vyk = otm = 0
    i = VYKUP_OTSTUP
    while i < VYKUP_OTSTUP + 70:
        for j in range(i, i + VYKUP_OKNO):
            z = (zakazy.get((d0 - dt.timedelta(days=j)).isoformat()) or {}).get(offer) or {}
            vyk += z.get("vykup", 0)
            otm += z.get("otmena", 0)
        i += VYKUP_OKNO
        if vyk + otm >= VYKUP_NORMA:
            break
    if vyk + otm >= VYKUP_MIN:
        out["vykup"] = vyk / (vyk + otm)
    return out


def obshchie_rovno(nach):
    """Общие расходы Ozon ровно по дням: расходы месяца поровну на его известные дни. Пока в месяце
    меньше 7 дней — средний день прошлого месяца (чтобы подписка в начале месяца не рушила день)."""
    po_mes = defaultdict(list)
    for d, z in nach.items():
        po_mes[d[:7]].append(z.get("obshchie") or 0)
    sred = {m: sum(v) / len(v) for m, v in po_mes.items()}
    out = {}
    for d in nach:
        m = d[:7]
        if len(po_mes[m]) >= 7:
            out[d] = sred[m]
        else:
            prosh = [x for x in sorted(sred) if x < m]
            out[d] = sred[prosh[-1]] if prosh else sred[m]
    return out


# ── День за днём ──────────────────────────────────────────────────────────────

def dni(nastroyki, zakazy, nach, reklama, snimki, s, po, poisk=None, rek_trafik=None):
    """Прибыль каждого отработавшего дня [s, po] по товарам и итогом."""
    tov_nast = nastroyki.get("tovary") or {}
    obsh = obshchie_rovno(nach)
    out = []
    d = dt.date.fromisoformat(s)
    while d <= dt.date.fromisoformat(po):
        den = d.isoformat()
        zak = zakazy.get(den) or {}
        rek = reklama.get(den) or {}
        pk = (poisk or {}).get(den) or {}
        rt = (rek_trafik or {}).get(den) or {}
        z_nal = po_date(nastroyki.get("nalog"), den)
        itog = defaultdict(float)
        po_tov = {}
        for offer in sorted(set(zak) | {a for a in rek if not a.startswith("_")}):
            nst = tov_nast.get(offer) or {}
            if nst.get("skryt"):
                continue
            z = zak.get(offer) or {"vsego": 0, "summa": 0}
            st = stavki(den, offer, nach, zakazy, snimki)
            vyk = st["vykup"] if st["vykup"] is not None else float(nst.get("vykup") or VYKUP_PO_UMOLCHANIYU)
            cena = z["summa"] / z["vsego"] if z["vsego"] else 0.0
            prod = z["vsego"] * vyk
            vyr = prod * cena
            kom = vyr * (st["komissiya"] or 0)
            log_ = prod * (st["logistika"] or 0)
            zakup = prod * float(nst.get("zakupka") or 0)
            ff = prod * float(nst.get("ff") or 0)
            rekl = float(rek.get(offer) or 0)
            nal = nalog_rub(z_nal, vyr * (st["dolya_bazy"] if st["dolya_bazy"] is not None else 1.0),
                            kom + log_ + zakup + ff + rekl)
            mp1 = vyr - kom - log_ - nal - zakup - ff
            r = {"zakazy": z["vsego"], "cena": round(cena, 2), "vykup": round(vyk, 4), "prodazhi": round(prod, 2),
                 "vyruchka": round(vyr, 2), "komissiya": round(kom, 2), "logistika": round(log_, 2),
                 "nalog": round(nal, 2), "zakupka": round(zakup + ff, 2), "reklama": round(rekl, 2),
                 "mp1": round(mp1, 2), "mp2": round(mp1 - rekl, 2),
                 "na_shtuke": round(mp1 / prod, 2) if prod else None,
                 "pusto": [k for k in ("komissiya", "logistika", "vykup") if st[k] is None]
                          + ([] if nst.get("zakupka") not in (None, "") else ["zakupka"]),
                 "komissiya_pct": round(st["komissiya"], 4) if st["komissiya"] is not None else None,
                 "istochnik_komissii": st["istochnik_komissii"]}
            if offer in pk:
                r["poisk"] = pk[offer]
            if offer in rt:
                r["rek_pokazy"], r["rek_kliki"] = rt[offer]["p"], rt[offer]["k"]
            po_tov[offer] = r
            for k in ("zakazy", "prodazhi", "vyruchka", "komissiya", "logistika", "nalog", "zakupka", "reklama", "mp1"):
                itog[k] += r[k]
        rek_bez = float(rek.get("_bez_tovara") or 0)
        obshchie = obsh.get(den)
        opr = opr_v_den(nastroyki, den)
        itog["reklama"] += rek_bez
        mp2 = itog["mp1"] - itog["reklama"] - (obshchie or 0)
        out.append({"d": den, **{k: round(v, 2) for k, v in itog.items()},
                    "obshchie": round(obshchie, 2) if obshchie is not None else None,
                    "opr": round(opr, 2), "mp2": round(mp2, 2), "chistymi": round(mp2 - opr, 2),
                    "tovary": po_tov})
        d += dt.timedelta(days=1)
    return out


# ── Факт по начислениям ───────────────────────────────────────────────────────

def fakt_mesyacev(nastroyki, nach):
    """Чистая прибыль по месяцам из начислений Ozon (как в отчёте «Начисления» кабинета):
    к выплате − реклама − закупка проданного − налог − свои расходы."""
    tov_nast = nastroyki.get("tovary") or {}
    po_mes = defaultdict(lambda: {"vidy": defaultdict(float), "n": defaultdict(float), "dney": 0})
    for d, z in nach.items():
        m = po_mes[d[:7]]
        m["dney"] += 1
        for k, v in (z.get("vidy") or {}).items():
            m["vidy"][k] += v
        for a, t in (z.get("tovary") or {}).items():
            m["n"][a] += t.get("n", 0)
    out = {}
    for mes, m in sorted(po_mes.items()):
        g = defaultdict(float)
        for k, v in m["vidy"].items():
            gr, vid = k.split("|", 1)
            if gr in ("Продажи", "Возвраты"):
                g["vyruchka"] += v
            elif gr == "Вознаграждение Ozon":
                g["komissiya"] += v
            elif gr == "Продвижение и реклама":
                g["reklama"] += v
            else:
                g["uslugi"] += v
        v_ = m["vidy"]
        bally = v_.get("Продажи|Баллы за скидки", 0) + v_.get("Возвраты|Баллы за скидки", 0)
        komis = -g["komissiya"]
        baza = (v_.get("Продажи|Выручка", 0) + v_.get("Возвраты|Возврат выручки", 0)
                + v_.get("Продажи|Программы партнёров", 0) + v_.get("Возвраты|Программы партнёров", 0)
                + max(0.0, bally - komis))
        sebest = sum(n * (float((tov_nast.get(a) or {}).get("zakupka") or 0) + float((tov_nast.get(a) or {}).get("ff") or 0))
                     for a, n in m["n"].items())
        bez_zakupki = sorted(a for a, n in m["n"].items() if n and (tov_nast.get(a) or {}).get("zakupka") in (None, ""))
        g_, mm = map(int, mes.split("-"))
        dney_v_mes = calendar.monthrange(g_, mm)[1]
        z_nal = po_date(nastroyki.get("nalog"), mes + "-01")
        k_vyplate = g["vyruchka"] + g["komissiya"] + g["uslugi"]
        rashody_dr = komis - g["uslugi"] - g["reklama"] + sebest
        nalog = nalog_rub(z_nal, baza, rashody_dr)
        opr = sum(opr_v_den(nastroyki, f"{mes}-{i:02d}") for i in range(1, m["dney"] + 1))
        valovaya = k_vyplate + g["reklama"] - sebest
        out[mes] = {"vyruchka": round(g["vyruchka"], 2), "komissiya": round(g["komissiya"], 2),
                    "uslugi": round(g["uslugi"], 2), "k_vyplate": round(k_vyplate, 2),
                    "reklama": round(g["reklama"], 2), "sebestoimost": round(-sebest, 2),
                    "nalog_baza": round(baza, 2), "nalog": round(-nalog, 2), "opr": round(-opr, 2),
                    "chistaya": round(valovaya - nalog - opr, 2),
                    "dney": m["dney"], "polnyy": m["dney"] == dney_v_mes, "bez_zakupki": bez_zakupki}
    return out
