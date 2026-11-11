-- ATLAS schema v6: grupos de questões (testlets) com texto-base compartilhado e detecção de questões repetidas.
CREATE TABLE IF NOT EXISTS grupos (
  id            INTEGER PRIMARY KEY,
  codigo        TEXT NOT NULL UNIQUE,      -- G + letra da disciplina + 6 dígitos (ex.: GL482913)
  disciplina    TEXT NOT NULL,
  autor_id      INTEGER NOT NULL REFERENCES usuarios(id),
  versao_atual  INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS grupo_versoes (
  grupo_id  INTEGER NOT NULL REFERENCES grupos(id),
  versao    INTEGER NOT NULL,
  dados     TEXT NOT NULL,                 -- JSON: {"texto-base": "...", "referencia": "..."}
  autor_id  INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (grupo_id, versao)
);
ALTER TABLE itens ADD COLUMN grupo_id INTEGER REFERENCES grupos(id);
ALTER TABLE itens ADD COLUMN ordem_grupo INTEGER;
CREATE INDEX IF NOT EXISTS idx_itens_grupo ON itens(grupo_id);
ALTER TABLE selecao_itens ADD COLUMN grupo_versao INTEGER;
-- Assinatura do texto (texto-base + comando + alternativas, sem formatação) para achar questões repetidas.
ALTER TABLE itens ADD COLUMN assinatura TEXT;
CREATE INDEX IF NOT EXISTS idx_itens_assinatura ON itens(disciplina, assinatura);
UPDATE meta SET valor = '6' WHERE chave = 'schema_versao';
