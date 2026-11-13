#!/usr/bin/env bash
# Baixa (via npm) as bibliotecas que os testes de tela servem localmente: KaTeX e ExcelJS.
set -e
T="${ATLAS_TESTE_TMP:-/tmp/atlas-testes}"
mkdir -p "$T/katexpkg" "$T/cdn"
cd "$T/katexpkg" && [ -f package/dist/katex.min.js ] || { npm pack katex@0.19.1 --silent >/dev/null && tar xzf katex-0.19.1.tgz; }
cd "$T/cdn" && [ -f package/dist/exceljs.min.js ] || { npm pack exceljs@4.4.0 --silent >/dev/null && tar xzf exceljs-4.4.0.tgz package/dist/exceljs.min.js; }
echo "Dependências prontas em $T"
