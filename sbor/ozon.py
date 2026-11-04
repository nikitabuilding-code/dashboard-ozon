"""Доступ к Ozon: Seller API (товары, заказы, начисления, цены) и Performance API (реклама).

Ключи — только из переменных окружения (в GitHub — секреты репозитория):
OZON_CLIENT_ID, OZON_API_KEY — Seller API, роль «только чтение» достаточна;
OZON_PERF_CLIENT_ID, OZON_PERF_SECRET — Performance API (реклама), можно не задавать.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

SELLER = "https://api-seller.ozon.ru"
PERF = "https://api-performance.ozon.ru"


class OshibkaOzon(Exception):
    """Ozon ответил ошибкой — текст для журнала, без ключей."""


def _zapros(url, telo=None, zagolovki=None, popytok=4, metod=None):
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    h.update(zagolovki or {})
    data = json.dumps(telo).encode() if telo is not None else None
    posledniy = None
    for n in range(popytok):
        req = urllib.request.Request(url, data=data, headers=h, method=metod or ("POST" if data else "GET"))
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            tekst = e.read()[:400].decode(errors="replace")
            posledniy = f"HTTP {e.code}: {tekst}"
            if e.code in (429, 500, 502, 503, 504) and n + 1 < popytok:
                time.sleep(4 * (n + 1))          # Ozon просит сбавить темп или прилёг
                continue
            raise OshibkaOzon(posledniy)
        except (urllib.error.URLError, TimeoutError) as e:
            posledniy = f"нет связи: {e}"
            if n + 1 < popytok:
                time.sleep(4 * (n + 1))
                continue
            raise OshibkaOzon(posledniy)
    raise OshibkaOzon(posledniy or "неизвестная ошибка")


def est_klyuchi():
    return bool(os.environ.get("OZON_CLIENT_ID") and os.environ.get("OZON_API_KEY"))


def est_reklama():
    return bool(os.environ.get("OZON_PERF_CLIENT_ID") and os.environ.get("OZON_PERF_SECRET"))


def seller(put, telo):
    return _zapros(SELLER + put, telo, {"Client-Id": os.environ["OZON_CLIENT_ID"],
                                        "Api-Key": os.environ["OZON_API_KEY"]})


_perf_token = {"t": None, "do": 0}


def _perf_tok():
    if _perf_token["t"] and time.time() < _perf_token["do"]:
        return _perf_token["t"]
    o = _zapros(PERF + "/api/client/token", {"client_id": os.environ["OZON_PERF_CLIENT_ID"],
                                             "client_secret": os.environ["OZON_PERF_SECRET"],
                                             "grant_type": "client_credentials"})
    _perf_token.update(t=o["access_token"], do=time.time() + int(o.get("expires_in", 1800)) - 120)
    return _perf_token["t"]


def perf(put, parametry=None):
    url = PERF + put + ("?" + urllib.parse.urlencode(parametry, doseq=True) if parametry else "")
    return _zapros(url, zagolovki={"Authorization": "Bearer " + _perf_tok()})
