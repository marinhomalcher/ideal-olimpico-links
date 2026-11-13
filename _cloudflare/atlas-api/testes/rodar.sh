#!/usr/bin/env bash
# Roda todas as suítes (ou as indicadas: ./rodar.sh itens tags). Cada uma tem limite de 110 s.
cd "$(dirname "$0")"
./preparar.sh >/dev/null
lista=("$@"); [ ${#lista[@]} -eq 0 ] && lista=($(ls teste-*.mjs | sed 's/teste-//; s/\.mjs//'))
for t in "${lista[@]}"; do
  printf "%-10s " "$t"
  timeout 110 node "teste-$t.mjs" 2>/dev/null | grep -E "FALHOU|TODOS|falha\(s\)" | head -5 | tr '\n' ' '; echo
done
