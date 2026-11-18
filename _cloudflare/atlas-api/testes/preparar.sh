#!/usr/bin/env bash
# Baixa (via npm) as bibliotecas que os testes de tela servem localmente: KaTeX, ExcelJS, pdf.js e pdf-lib.
set -e
T="${ATLAS_TESTE_TMP:-/tmp/atlas-testes}"
mkdir -p "$T/katexpkg" "$T/cdn" "$T/pdfjs" "$T/pdflib"
cd "$T/katexpkg" && [ -f package/dist/katex.min.js ] || { npm pack katex@0.19.1 --silent >/dev/null && tar xzf katex-0.19.1.tgz; }
cd "$T/cdn" && [ -f package/dist/exceljs.min.js ] || { npm pack exceljs@4.4.0 --silent >/dev/null && tar xzf exceljs-4.4.0.tgz package/dist/exceljs.min.js; }
cd "$T/pdfjs" && [ -f package/build/pdf.worker.min.mjs ] || { npm pack pdfjs-dist@4.10.38 --silent >/dev/null && tar xzf pdfjs-dist-4.10.38.tgz package/build/pdf.min.mjs package/build/pdf.worker.min.mjs; }
cd "$T/pdflib" && [ -f package/dist/pdf-lib.min.js ] || { npm pack pdf-lib@1.17.1 --silent >/dev/null && tar xzf pdf-lib-1.17.1.tgz package/dist/pdf-lib.min.js; }
echo "Dependências prontas em $T"
