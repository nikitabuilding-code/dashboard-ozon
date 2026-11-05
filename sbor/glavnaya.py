"""Ежедневный сбор «Dashboard Ozon»: Ozon → dannye/ → sayt/data.json.

Запуск: python3 sbor/glavnaya.py  (ключи Ozon — в переменных окружения, см. ozon.py).
Первый запуск сам заводит nastroyki.json, подтягивает товары и историю за ISTORIYA_DNEY дней.

Несколько магазинов (кабинетов Ozon) в одной копии: первый — секреты OZON_CLIENT_ID, OZON_API_KEY,
OZON_PERF_CLIENT_ID, OZON_PERF_SECRET; второй и дальше — те же имена с номером: OZON_CLIENT_ID_2 и т. д.
Все секреты робот получает одной переменной SEKRETY (в sbor.yml: toJSON(secrets)). Данные первого магазина —
dannye/ и nastroyki.json, остальных — magaziny/<номер>/dannye/ и magaziny/<номер>/nastroyki.json.
Всё уходит на страницу одним шифром; адрес и пароль общие.
"""
import datetime as dt
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import istochniki as I  # noqa: E402
import ozon  # noqa: E402
import raschet as R  # noqa: E402
import shifr  # noqa: E402

ISTORIYA_DNEY = 90
POKAZYVAT_DNEY = 120
NASTROYKI = os.path.join(I.KOREN, "nastroyki.json")
DATA = os.path.join(I.KOREN, "sayt", "data.json")
VERSIYA = "2026.11.10"
MAKS_MAGAZINOV = 9
KLYUCHI = ("OZON_CLIENT_ID", "OZON_API_KEY", "OZON_PERF_CLIENT_ID", "OZON_PERF_SECRET")

NASTROYKI_PO_UMOLCHANIYU = {
    "magazin": "",
    "tovary": {},
    "nalog": [{"s": "2020-01-01", "rezhim": "usn_dohody", "usn": 0.06, "nds": 0}],
    "opr": [],
    "istoriya_s": None,
}


def nastroyki():
    try:
        with open(NASTROYKI, encoding="utf-8") as f:
            n = json.load(f)
    except (OSError, ValueError):
        n = {}
    return {**NASTROYKI_PO_UMOLCHANIYU, **n}


class Zhurnal(list):
    """Журнал, который сразу печатает каждую запись: в GitHub видно, как идёт сбор, а не только в конце."""
    def append(self, z):
        print("·", z, flush=True)
        super().append(z)


def sekrety():
    """Все секреты копии. Новый sbor.yml отдаёт их одной переменной SEKRETY; старый — только 7 по именам."""
    try:
        vse = json.loads(os.environ.get("SEKRETY") or "")
        if isinstance(vse, dict):
            return {k: str(v) for k, v in vse.items()}, True
    except ValueError:
        pass
    return {k: os.environ[k] for k in KLYUCHI if os.environ.get(k)}, False


def magaziny(sek):
    """Номера магазинов, для которых в сейфе есть ключи Seller API: [1, 2, …]."""
    nomera = [1] if sek.get("OZON_CLIENT_ID") and sek.get("OZON_API_KEY") else []
    for k in range(2, MAKS_MAGAZINOV + 1):
        if sek.get(f"OZON_CLIENT_ID_{k}") and sek.get(f"OZON_API_KEY_{k}"):
            nomera.append(k)
    return nomera


def vybrat_magazin(k, sek):
    """Переключить сбор на магазин k: его ключи, его папка данных и настроек."""
    global NASTROYKI, DATA
    hvost = "" if k == 1 else f"_{k}"
    for imya in KLYUCHI:
        znach = sek.get(imya + hvost)
        if znach:
            os.environ[imya] = znach
        else:
            os.environ.pop(imya, None)
    ozon._perf_token.update(t=None, do=0)
    papka = I.KOREN if k == 1 else os.path.join(I.KOREN, "magaziny", str(k))
    I.DANNYE = os.path.join(papka, "dannye")
    NASTROYKI = os.path.join(papka, "nastroyki.json")
    DATA = os.path.join(I.KOREN, "sayt", "data.json") if k == 1 else os.path.join(papka, "data.json")


def main():
    sek, vse_sekrety = sekrety()
    nomera = magaziny(sek)
    if not nomera:
        print("Нет ключей Ozon: задайте OZON_CLIENT_ID и OZON_API_KEY в секретах репозитория.")
        return 1
    if not vse_sekrety:
        print("· робот старой версии: видит только первый магазин. Чтобы добавить ещё магазины, обновите файл "
              ".github/workflows/sbor.yml (Dashboard → Настройки → «Магазины»).", flush=True)
    paket = []
    for k in nomera:
        vybrat_magazin(k, sek)
        print(f"\n══ Магазин {k} ══", flush=True)
        try:
            data = sobrat_magazin(k)
        except Exception as e:                      # один магазин упал целиком — остальные всё равно на страницу
            traceback.print_exc()
            data = {"versiya": VERSIYA, "magazin": nastroyki().get("magazin") or "", "oshibki": [f"сбор: {e}"],
                    "dni": [], "fakt": [], "tovary": {}, "obnovleno": dt.datetime.now(I.MSK).isoformat(timespec="minutes")}
        paket.append({"n": k, "nazvanie": data.get("magazin") or f"Магазин {k}", "data": data})
    robot = {"vse_sekrety": vse_sekrety, "sleduyushchiy": next(k for k in range(2, MAKS_MAGAZINOV + 2) if k not in nomera)}
    return otpravit_na_stranicu(paket, robot)


def sobrat_magazin(k):
    zhurnal, oshibki = Zhurnal(), []
    print("Начинаю сбор. Первый раз — история за 3 месяца, это 5–15 минут.", flush=True)
    n = nastroyki()
    segodnya = I.segodnya()
    # Настройки пишет только страница «Настройки» — сборщик их не трогает, чтобы не затереть правки.
    # Начало истории: из настроек, иначе — с первого собранного дня, иначе — ISTORIYA_DNEY назад.
    papka = os.path.join(I.DANNYE, "nachisleniya")
    est = sorted(f[:7] for f in os.listdir(papka) if f.endswith(".json")) if os.path.isdir(papka) else []
    perviy = min(I.chitat(f"nachisleniya/{est[0]}.json")) if est and I.chitat(f"nachisleniya/{est[0]}.json") else None
    s = n.get("istoriya_s") or perviy or (segodnya - dt.timedelta(days=ISTORIYA_DNEY)).isoformat()

    tovary, karta = I.tovary(zhurnal)
    novye = sorted(a for a in tovary if a not in n["tovary"])
    if novye:
        zhurnal.append(f"настройки: новые товары без закупки — {', '.join(novye)}")

    def shag(imya, f, pusto):
        try:
            return f()
        except Exception as e:                      # источник упал — остальное всё равно считаем
            oshibki.append(f"{imya}: {e}")
            print(f"⚠ {imya}: {e}", flush=True)
            traceback.print_exc()
            return pusto

    est_zakazy = bool(I.chitat("zakazy.json"))
    dney_zak = 40 if est_zakazy else (segodnya - dt.date.fromisoformat(s)).days + 10
    zakazy = shag("заказы", lambda: I.zakazy(zhurnal, dney_zak), I.chitat("zakazy.json"))
    nach = shag("начисления", lambda: I.nachisleniya(zhurnal, karta, s), {})
    reklama = shag("реклама", lambda: I.reklama(zhurnal, karta, zakazy, s), I.chitat("reklama.json"))
    snimki = shag("комиссия", lambda: I.komissiya(zhurnal, tovary), I.chitat("komissiya.json"))
    poisk = shag("поиск", lambda: I.poisk(zhurnal, tovary), I.chitat("poisk.json"))
    rek_trafik = I.chitat("reklama_trafik.json")

    vchera = (segodnya - dt.timedelta(days=1)).isoformat()
    nachalo = max(s, (segodnya - dt.timedelta(days=POKAZYVAT_DNEY)).isoformat())
    dni = R.dni(n, zakazy, nach, reklama, snimki, nachalo, vchera, poisk, rek_trafik)
    fakt = R.fakt_mesyacev(n, {d: z for d, z in nach.items() if d >= s})
    data = {
        "versiya": VERSIYA,
        "magazin": n.get("magazin") or "",
        "obnovleno": dt.datetime.now(I.MSK).isoformat(timespec="minutes"),
        "tovary": {a: {"nazvanie": t["nazvanie"], "foto": t.get("foto") or ""} for a, t in tovary.items()
                   if not (n["tovary"].get(a) or {}).get("skryt")},
        "bez_zakupki": sorted(a for a in tovary if (n["tovary"].get(a) or {}).get("zakupka") in (None, "")
                              and not (n["tovary"].get(a) or {}).get("skryt")),
        "istoriya_s": s,
        "dni": dni,
        "fakt": fakt,
        "nalog_sejchas": R.po_date(n.get("nalog"), vchera),
        "zhurnal": zhurnal,
        "oshibki": oshibki,
    }
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(DATA + ".tmp", DATA)
    print(f"Готово: посчитано дней {len(dni)}, месяцев факта {len(fakt)}"
          + (f", ошибок {len(oshibki)}" if oshibki else ", без ошибок"), flush=True)
    return data


def otpravit_na_stranicu(paket, robot):
    """Запереть результат паролем и отправить шифр на сервер-«окно». Ошибка — красный крестик в GitHub."""
    parol, propusk = os.environ.get("PAROL") or "", os.environ.get("DO_PROPUSK") or ""
    if not propusk or not parol:
        print("⚠ Страница не обновлена: в сейфе GitHub нет " + " и ".join(
            x for x, v in (("PAROL", parol), ("DO_PROPUSK", propusk)) if not v) + " (шаг 5 инструкции).", flush=True)
        return 1
    prichina = shifr.slabyy(parol)
    if prichina:
        print(f"⚠ Страница не обновлена: пароль слишком простой — {prichina}. Задайте новый PAROL в сейфе GitHub "
              "(от 12 знаков, буквы и цифры, не слово и не дата).", flush=True)
        return 1
    adres = propusk.split(":", 1)[0]
    gh = {"repo": os.environ.get("GITHUB_REPOSITORY") or "", "token": os.environ.get("PROPUSK_GITHUB") or ""}
    try:
        # data — первый магазин (так страница старой версии тоже откроется), magaziny — все
        shifr.otpravit(shifr.zaperet({"data": paket[0]["data"], "magaziny": paket, "robot": robot, "gh": gh},
                                     parol, adres, gh["repo"]), propusk)
    except Exception as e:
        print(f"⚠ Страница не обновлена: {e}", flush=True)
        return 1
    print(f"· страница обновлена: данные заперты вашим паролем и отправлены (магазинов: {len(paket)})", flush=True)
    print(f"· адрес вашего Dashboard: {shifr.SERVER.rstrip('/')}/{adres}/", flush=True)
    if not gh["token"]:
        print("⚠ Нет секрета PROPUSK_GITHUB — на странице не будут работать «Настройки» (шаг 3 и 5).", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
