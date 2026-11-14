#!/usr/bin/env bash
# conferir-paridade.sh — a conta em TypeScript tem que dar o mesmo número que a
# conta em Python, até o centavo.
#
# O backend Python é a referência (79 testes, conferido contra extrato real).
# Rode isto depois de qualquer mexida em classificador.ts, financeiro.ts ou
# politica.ts, e antes de publicar a edge function.
#
#     ./conferir-paridade.sh
#
# Saída esperada: "paridade OK".
set -euo pipefail
cd "$(dirname "$0")"

TMP="${TMPDIR:-/tmp}/bmoto-paridade"
mkdir -p "$TMP"

PERSIST_DB="$TMP/paridade.db" python3 teste_paridade.py > "$TMP/py.json"
npx --yes tsx teste.ts > "$TMP/ts.json"

python3 - "$TMP/py.json" "$TMP/ts.json" <<'PY'
import json, sys

py, ts = (json.load(open(p)) for p in sys.argv[1:3])

# Diferenças justificadas, não divergências de cálculo:
#   limite_mei_ano — no Python entra no router (/me/resumo); na edge function
#   já vem no próprio resumo, porque lá não existe uma camada acima.
ESPERADAS = {"limite_mei_ano"}

dif = []


def comparar(caminho, a, b):
    if caminho.rsplit(".", 1)[-1] in ESPERADAS:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            comparar(f"{caminho}.{k}", a.get(k, "<ausente>"), b.get(k, "<ausente>"))
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            dif.append((caminho, f"{len(a)} itens", f"{len(b)} itens"))
            return
        for i, (x, y) in enumerate(zip(a, b)):
            comparar(f"{caminho}[{i}]", x, y)
    elif (isinstance(a, (int, float)) and isinstance(b, (int, float))
          and not isinstance(a, bool) and not isinstance(b, bool)):
        if abs(a - b) > 1e-9:                      # centavo é divergência
            dif.append((caminho, a, b))
    elif a != b:
        dif.append((caminho, a, b))


comparar("", py, ts)

if dif:
    print(f"DIVERGÊNCIA em {len(dif)} ponto(s) entre Python e TypeScript:")
    for caminho, a, b in dif[:60]:
        print(f"  {caminho}: python={a!r}  ts={b!r}")
    sys.exit(1)
print("paridade OK")
PY
