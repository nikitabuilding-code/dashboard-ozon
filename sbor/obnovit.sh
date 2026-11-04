#!/bin/bash
# Подтягивает свежий код из открытого шаблона, не трогая настройки и историю пользователя.
# Задачи GitHub (.github/workflows) не обновляются: GitHub не разрешает это автоматике.
set -eu
SHABLON="${SHABLON_REPO:-$(cat sbor/SHABLON 2>/dev/null || echo nikitabuilding-code/dashboard-ozon)}"
vrem=$(mktemp -d)
git clone -q --depth 1 "https://github.com/$SHABLON.git" "$vrem/s"
for put in sbor sayt INSTRUKCIYA.md; do
  [ -e "$vrem/s/$put" ] || continue
  if [ "$put" = "sayt" ]; then
    find "$vrem/s/sayt" -name data.json -delete
    cp -r "$vrem/s/sayt/." sayt/
  else
    rm -rf "$put" && cp -r "$vrem/s/$put" "$put"
  fi
done
git config user.name "dashboard-ozon"
git config user.email "dashboard-ozon@users.noreply.github.com"
git add -A sbor sayt INSTRUKCIYA.md
if git diff --cached --quiet; then echo "Уже последняя версия"; exit 0; fi
git commit -q -m "Обновление из шаблона $(cat sbor/VERSIYA 2>/dev/null)"
git push -q origin HEAD:main
echo "Обновлено"
