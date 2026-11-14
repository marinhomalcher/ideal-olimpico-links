#!/usr/bin/env bash
# Roda todas as suítes (ou as indicadas: ./rodar.sh itens tags). Cada uma tem limite de 110 s.
cd "$(dirname "$0")"
./preparar.sh >/dev/null || exit 1
lista=("$@"); [ ${#lista[@]} -eq 0 ] && lista=($(ls teste-*.mjs | sed 's/teste-//; s/\.mjs//'))
falhou=0
for t in "${lista[@]}"; do
  saida=$(timeout 110 node "teste-$t.mjs" 2>&1); codigo=$?
  resumo=$(printf '%s\n' "$saida" | grep -E 'FALHOU|TODOS|falha\(s\)|FALHA\(S\)' | head -5 | tr '\n' ' ')
  printf '%-20s %s\n' "$t" "$resumo"
  if [ "$codigo" -ne 0 ] || printf '%s\n' "$saida" | grep -Eq 'FALHOU|[1-9][0-9]* falha\(s\)|[1-9][0-9]* FALHA\(S\)' || ! printf '%s\n' "$saida" | grep -Eq 'TODOS|0 falha\(s\)'; then
    printf '%s\n' "$saida" | tail -20
    falhou=1
  fi
done
exit "$falhou"
