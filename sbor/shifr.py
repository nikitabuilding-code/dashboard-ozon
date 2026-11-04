"""Замок для данных страницы: запереть паролем пользователя и отправить шифр на сервер-«окно».

Шифр: AES-256-GCM, ключ — PBKDF2-SHA256 из пароля, 600 000 повторов (перебор пароля медленный).
Соль постоянная для адреса пользователя — чтобы браузер мог запомнить ключ и не спрашивать пароль каждый день.
Перед шифрованием данные сжимаются (gzip). Отпирает браузер пользователя (sayt/app.js, WebCrypto) — сервер не может.
"""
import base64
import gzip
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

POVTOROV = 600_000
SERVER = os.environ.get("DO_SERVER") or "https://vibeforge7.com/dashboard-ozon"


def _aesgcm():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:                     # на машине GitHub библиотеки нет — ставим на время запуска
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "cryptography"], check=True)
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return AESGCM


def slabyy(parol):
    """Текст причины, если пароль слишком простой; None — если годится."""
    if len(parol) < 12:
        return "короче 12 знаков"
    if not any(c.isalpha() for c in parol) or not any(c.isdigit() for c in parol):
        return "нужны и буквы, и цифры"
    if len(set(parol.lower())) < 7:
        return "слишком много повторяющихся знаков"
    return None


def zaperet(dannye, parol, adres, repo=""):
    AESGCM = _aesgcm()
    sol = hashlib.sha256(("dashboard-ozon-sol:" + adres).encode()).digest()[:16]
    klyuch = hashlib.pbkdf2_hmac("sha256", parol.encode("utf-8"), sol, POVTOROV, 32)
    iv = os.urandom(12)
    otkrytoe = gzip.compress(json.dumps(dannye, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    ct = AESGCM(klyuch).encrypt(iv, otkrytoe, None)
    b64 = lambda b: base64.b64encode(b).decode()
    # repo — открыто, без цифр: нужно кнопке «Забыли пароль?», чтобы вести прямо в свою копию на GitHub
    return {"v": 1, "kdf": "pbkdf2-sha256", "iter": POVTOROV, "salt": b64(sol), "iv": b64(iv), "zip": "gzip", "ct": b64(ct),
            "repo": repo}


def otpravit(shifr, propusk):
    telo = json.dumps(shifr).encode()
    req = urllib.request.Request(SERVER.rstrip("/") + "/api/zagruzka", data=telo, method="POST",
                                 headers={"Content-Type": "application/json", "X-Propusk": propusk,
                                          "User-Agent": "dashboard-ozon-robot"})
    for n in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            tekst = e.read().decode(errors="replace")[:300]
            try:
                tekst = json.loads(tekst).get("oshibka") or tekst
            except ValueError:
                pass
            if e.code in (403, 400, 413):
                raise RuntimeError(tekst)
            posl = f"HTTP {e.code}: {tekst}"
        except (urllib.error.URLError, TimeoutError) as e:
            posl = f"нет связи с сервером: {e}"
        import time
        time.sleep(5 * (n + 1))
    raise RuntimeError(posl)
