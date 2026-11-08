-- ATLAS schema v5: seleções de questões para provas (módulo BQI, etapa 1).
-- A série e o tipo pertencem à seleção, não à questão.
CREATE TABLE IF NOT EXISTS selecoes (
  id            INTEGER PRIMARY KEY,
  disciplina    TEXT NOT NULL,
  supervisor_id INTEGER NOT NULL REFERENCES usuarios(id),
  serie         INTEGER NOT NULL CHECK (serie IN (1,2,3)),
  tipo          TEXT NOT NULL CHECK (tipo IN ('REG','MED')),
  titulo        TEXT,
  situacao      TEXT NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho','enviada','aplicada')),
  ano           INTEGER,                 -- preenchido quando o ADM marca a prova como aplicada
  motivo_devolucao TEXT,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  enviada_em    TEXT,
  aplicada_em   TEXT
);
CREATE INDEX IF NOT EXISTS idx_selecoes_disciplina ON selecoes(disciplina, situacao);
CREATE TABLE IF NOT EXISTS selecao_itens (
  selecao_id INTEGER NOT NULL REFERENCES selecoes(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES itens(id),
  ordem      INTEGER NOT NULL,
  versao     INTEGER NOT NULL,            -- versão da questão congelada no envio
  PRIMARY KEY (selecao_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_selecao_itens_item ON selecao_itens(item_id);
UPDATE meta SET valor = '5' WHERE chave = 'schema_versao';
