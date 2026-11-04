#!/bin/bash
# Сохраняет собранные данные в репозиторий (вызывается из задачи «Сбор данных»).
set -u
git config user.name "dashboard-ozon"
git config user.email "dashboard-ozon@users.noreply.github.com"
git add dannye sayt/data.json 2>/dev/null || true   # nastroyki.json пишет только страница
if git diff --cached --quiet; then
  echo "Данные не изменились"
  exit 0
fi
git commit -q -m "${1:-Сбор данных} $(TZ=Europe/Moscow date +%Y-%m-%d)"
for i in 1 2 3; do
  git pull -q --rebase -X theirs origin main && git push -q origin HEAD:main && exit 0
  sleep 5
done
echo "Не удалось сохранить данные" >&2
exit 1
