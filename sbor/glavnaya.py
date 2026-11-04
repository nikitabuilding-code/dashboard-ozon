"""Ежедневный сбор «Dashboard Ozon»: Ozon → dannye/ → sayt/data.json.

Запуск: python3 sbor/glavnaya.py  (ключи Ozon — в переменных окружения, см. ozon.py).
Первый запуск сам заводит nastroyki.json, подтягивает товары и историю за ISTORIYA_DNEY дней.
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
VERSIYA = "2026.11.7"

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


def main():
    zhurnal, oshibki = Zhurnal(), []
    print("Начинаю сбор. Первый раз — история за 3 месяца, это 5–15 минут.", flush=True)
    if not ozon.est_klyuchi():
        print("Нет ключей Ozon: задайте OZON_CLIENT_ID и OZON_API_KEY в секретах репозитория.")
        return 1
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

    vchera = (segodnya - dt.timedelta(days=1)).isoformat()
    nachalo = max(s, (segodnya - dt.timedelta(days=POKAZYVAT_DNEY)).isoformat())
    dni = R.dni(n, zakazy, nach, reklama, snimki, nachalo, vchera)
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
    return otpravit_na_stranicu(data)


def otpravit_na_stranicu(data):
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
        shifr.otpravit(shifr.zaperet({"data": data, "gh": gh}, parol, adres, gh["repo"]), propusk)
    except Exception as e:
        print(f"⚠ Страница не обновлена: {e}", flush=True)
        return 1
    print("· страница обновлена: данные заперты вашим паролем и отправлены", flush=True)
    print(f"· адрес вашего Dashboard: {shifr.SERVER.rstrip('/')}/{adres}/", flush=True)
    if not gh["token"]:
        print("⚠ Нет секрета PROPUSK_GITHUB — на странице не будут работать «Настройки» (шаг 3 и 5).", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
