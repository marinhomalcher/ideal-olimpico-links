-- ATLAS — estrutura inicial do banco (D1 / SQLite). Versão 1, modo de teste.
-- Datas em texto ISO 8601 (UTC). Conteúdo da questão em JSON na tabela de versões.

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- e-mail institucional (login Microsoft)
  disciplina  TEXT,                                  -- disciplina principal (professor/supervisor)
  papel       TEXT NOT NULL CHECK (papel IN ('professor','supervisor','adm')),
  ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Uma linha por questão. O conteúdo fica em item_versoes (histórico completo).
CREATE TABLE IF NOT EXISTS itens (
  id             INTEGER PRIMARY KEY,
  codigo         TEXT UNIQUE,          -- ID oficial (letra + 6/7 dígitos), definido na aprovação; formato a confirmar
  disciplina     TEXT NOT NULL,
  autor_id       INTEGER NOT NULL REFERENCES usuarios(id),
  situacao       TEXT NOT NULL DEFAULT 'analise'
                 CHECK (situacao IN ('rascunho','analise','ajustes','aprovado','descartado')),
  versao_atual   INTEGER NOT NULL DEFAULT 1,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_itens_situacao   ON itens(situacao, disciplina);
CREATE INDEX IF NOT EXISTS idx_itens_autor      ON itens(autor_id);

-- Cada envio/correção gera uma nova versão; nada é sobrescrito.
CREATE TABLE IF NOT EXISTS item_versoes (
  item_id    INTEGER NOT NULL REFERENCES itens(id),
  versao     INTEGER NOT NULL,
  dados      TEXT NOT NULL CHECK (json_valid(dados)),  -- campos do formulário (comando, alternativas, gabarito, assunto...)
  autor_id   INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (item_id, versao)
);

-- Decisões do supervisor sobre uma versão.
CREATE TABLE IF NOT EXISTS revisoes (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES itens(id),
  versao         INTEGER NOT NULL,
  supervisor_id  INTEGER NOT NULL REFERENCES usuarios(id),
  decisao        TEXT NOT NULL CHECK (decisao IN ('aprovar','ajuste','descartar')),
  motivo         TEXT,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_revisoes_item ON revisoes(item_id);

-- Registro de tudo o que acontece (quem fez o quê e quando).
CREATE TABLE IF NOT EXISTS eventos (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER REFERENCES usuarios(id),
  acao        TEXT NOT NULL,
  item_id     INTEGER REFERENCES itens(id),
  detalhe     TEXT,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_eventos_item ON eventos(item_id);

CREATE TABLE IF NOT EXISTS meta (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (chave, valor) VALUES ('schema_versao', '1');
