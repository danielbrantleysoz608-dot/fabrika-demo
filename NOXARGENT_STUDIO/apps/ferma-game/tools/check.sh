#!/usr/bin/env sh
# Проверка синтаксиса всех модулей игры так, как их видит браузер (ES-модули).
# Запуск: sh tools/check.sh   — молчит, если всё в порядке.
cd "$(dirname "$0")/../webapp/js" || exit 1
fail=0
for f in *.js; do
  node --input-type=module --check < "$f" 2>/tmp/ferma-check.txt || { echo "ОШИБКА в $f:"; head -5 /tmp/ferma-check.txt; fail=1; }
done
exit $fail
