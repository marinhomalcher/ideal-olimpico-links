-- ATLAS schema v8: retirada das questões autorais de professor desligado (com prazo para desfazer).
CREATE TABLE IF NOT EXISTS retiradas (
  id               INTEGER PRIMARY KEY,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),   -- professor desligado
  motivo           TEXT NOT NULL,
  itens            TEXT NOT NULL,                               -- JSON [{id, codigo, situacao}] com a situação anterior
  total            INTEGER NOT NULL,
  situacao         TEXT NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa','desfeita','excluida')),
  prazo_em         TEXT NOT NULL,                               -- AAAA-MM-DD: a partir daí o ADM decide a exclusão definitiva
  aviso_enviado_em TEXT,
  criado_por       TEXT NOT NULL,
  criado_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finalizado_em    TEXT,
  detalhe          TEXT
);
CREATE INDEX IF NOT EXISTS idx_retiradas_situacao ON retiradas(situacao, prazo_em);
ALTER TABLE itens ADD COLUMN retirada_id INTEGER REFERENCES retiradas(id);
UPDATE meta SET valor = '8' WHERE chave = 'schema_versao';
