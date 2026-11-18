-- v17: envio automático da Redação (decisão do Marinho, 17/11/2026).
-- O digitalizador escolhe só bimestre e unidade; o navegador lê o RA de cada folha, separa as páginas
-- por turma e cada turma recebe as suas no lote dela (um lote por turma e bimestre, como antes).
-- Folhas que chegam depois entram no fim do mesmo lote. Um "envio" junta tudo o que foi mandado de uma vez,
-- para o digitalizador poder desfazer enquanto nenhuma professora começou a corrigir.
CREATE TABLE redacao_envios (
  id TEXT PRIMARY KEY,                          -- identificador aleatório criado no envio
  ano INTEGER NOT NULL,
  bimestre INTEGER NOT NULL CHECK (bimestre BETWEEN 1 AND 4),
  unidade TEXT NOT NULL CHECK (unidade IN ('BC','AM','CN')),
  digitalizador_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  desfeito_em TEXT,
  desfeito_por TEXT
);
CREATE INDEX idx_redacao_envios_dig ON redacao_envios (digitalizador_id, criado_em);
ALTER TABLE redacao_paginas ADD COLUMN envio_id TEXT;
CREATE INDEX idx_redacao_paginas_envio ON redacao_paginas (envio_id);
-- quantas páginas tem o PDF guardado do lote (as folhas novas entram depois da última)
ALTER TABLE redacao_lotes ADD COLUMN paginas_arquivo INTEGER;

UPDATE meta SET valor = '17' WHERE chave = 'schema_versao';
