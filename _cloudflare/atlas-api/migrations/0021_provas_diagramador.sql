-- v21: provas do bimestre e Diagramador (decisões do Marinho em 23 e 24/11/2026).
-- Diagramador: recebe por e-mail o caderno (Word) de cada prova fechada; não entra no ATLAS.
ALTER TABLE usuarios ADD COLUMN diagramador INTEGER NOT NULL DEFAULT 0 CHECK (diagramador IN (0,1));

-- Prova do bimestre: o ADM define série, turma (REG, MED ou MIL), modalidade (simulado particular, ENEM 1º ou 2º dia),
-- data de aplicação e quantas questões de cada disciplina. Cada disciplina entra com uma seleção do supervisor;
-- quando todas enviam, a prova fecha e o caderno vai ao Diagramador.
CREATE TABLE provas (
  id            INTEGER PRIMARY KEY,
  ano           INTEGER NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  bimestre      INTEGER NOT NULL CHECK (bimestre BETWEEN 1 AND 4),
  serie         INTEGER NOT NULL CHECK (serie IN (1,2,3)),
  tipo          TEXT NOT NULL CHECK (tipo IN ('REG','MED','MIL')),
  modalidade    TEXT NOT NULL CHECK (modalidade IN ('PART','ENEM1','ENEM2')),
  aplicacao     TEXT NOT NULL,            -- AAAA-MM-DD (obrigatória)
  situacao      TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta','fechada','enviada','aplicada')),
  arquivo       TEXT,                     -- chave no R2 do Word gerado (provas/<id>/<nome>.docx)
  aviso         TEXT,                     -- motivo de a prova estar fechada sem e-mail (ex.: nenhum Diagramador cadastrado)
  enviada_em    TEXT,
  enviada_para  TEXT,                     -- JSON: e-mails dos Diagramadores que receberam
  reenviada_em  TEXT,
  aplicada_em   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_provas_ano ON provas(ano, bimestre);
CREATE TABLE prova_disciplinas (
  prova_id   INTEGER NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
  disciplina TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 200),
  selecao_id INTEGER,                      -- seleção do supervisor ligada a esta disciplina (NULL até ele começar)
  PRIMARY KEY (prova_id, disciplina)
);

-- Seleções ganham a turma MIL e o vínculo com a prova. O SQLite não altera uma regra CHECK, então a tabela é refeita
-- (mesmas colunas + prova_id). selecao_itens continua apontando para "selecoes": a conferência das chaves fica
-- adiada até o fim da migração, quando a tabela nova já tem o nome antigo. Como o DROP TABLE apaga em cascata as
-- linhas de selecao_itens, elas são guardadas numa cópia e devolvidas no fim.
PRAGMA defer_foreign_keys = true;
CREATE TABLE selecao_itens_v21 AS SELECT * FROM selecao_itens;
CREATE TABLE selecoes_v21 (
  id            INTEGER PRIMARY KEY,
  disciplina    TEXT NOT NULL,
  supervisor_id INTEGER NOT NULL REFERENCES usuarios(id),
  serie         INTEGER NOT NULL CHECK (serie IN (1,2,3)),
  tipo          TEXT NOT NULL CHECK (tipo IN ('REG','MED','MIL')),
  titulo        TEXT,
  situacao      TEXT NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho','enviada','aplicada')),
  ano           INTEGER,
  motivo_devolucao TEXT,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  enviada_em    TEXT,
  aplicada_em   TEXT,
  prova_id      INTEGER REFERENCES provas(id)
);
INSERT INTO selecoes_v21 (id, disciplina, supervisor_id, serie, tipo, titulo, situacao, ano, motivo_devolucao, criado_em, atualizado_em, enviada_em, aplicada_em)
  SELECT id, disciplina, supervisor_id, serie, tipo, titulo, situacao, ano, motivo_devolucao, criado_em, atualizado_em, enviada_em, aplicada_em FROM selecoes;
DROP TABLE selecoes;
ALTER TABLE selecoes_v21 RENAME TO selecoes;
CREATE INDEX idx_selecoes_disciplina ON selecoes(disciplina, situacao);
CREATE INDEX idx_selecoes_prova ON selecoes(prova_id);
INSERT INTO selecao_itens (selecao_id, item_id, ordem, versao, grupo_versao) SELECT selecao_id, item_id, ordem, versao, grupo_versao FROM selecao_itens_v21;
DROP TABLE selecao_itens_v21;

UPDATE meta SET valor = '21' WHERE chave = 'schema_versao';
