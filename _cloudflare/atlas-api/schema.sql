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

-- ===== Versão 2: sessões de login (administrador via Google; professores via código no e-mail) =====
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  TEXT PRIMARY KEY,                      -- SHA-256 do token; o token em si nunca é guardado
  tipo        TEXT NOT NULL CHECK (tipo IN ('adm','usuario')),
  email       TEXT NOT NULL COLLATE NOCASE,
  usuario_id  INTEGER REFERENCES usuarios(id),
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expira_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em);
UPDATE meta SET valor = '2' WHERE chave = 'schema_versao';

-- ===== Versão 3: login por código no e-mail (igual a migrations/0003_email_login_codes.sql) =====
CREATE TABLE IF NOT EXISTS login_codigos (
  usuario_id  INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL,
  expira_em   INTEGER NOT NULL,
  tentativas  INTEGER NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_login_codigos_expira ON login_codigos(expira_em);

CREATE TABLE IF NOT EXISTS login_rate_limits (
  chave         TEXT PRIMARY KEY,
  janela_inicio INTEGER NOT NULL,
  quantidade    INTEGER NOT NULL CHECK (quantidade > 0)
);
CREATE INDEX IF NOT EXISTS idx_login_rate_limits_janela ON login_rate_limits(janela_inicio);

UPDATE meta SET valor = '3' WHERE chave = 'schema_versao';

-- ===== Versão 4: pedidos de conserto (igual a migrations/0004_consertos.sql) =====
CREATE TABLE IF NOT EXISTS consertos (
  id              INTEGER PRIMARY KEY,
  item_id         INTEGER NOT NULL REFERENCES itens(id),
  solicitante_id  INTEGER NOT NULL REFERENCES usuarios(id),
  motivo          TEXT NOT NULL,
  situacao        TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente','feito','recusado')),
  resposta        TEXT,
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  resolvido_em    TEXT
);
CREATE INDEX IF NOT EXISTS idx_consertos_situacao ON consertos(situacao, item_id);

UPDATE meta SET valor = '4' WHERE chave = 'schema_versao';

-- ---------- v5 ----------
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

-- ---------- v6 ----------
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

-- ---------- v7 ----------
-- ATLAS schema v7: digitador (só envia questões, sem classificar) e acesso com data de término.
ALTER TABLE usuarios ADD COLUMN digitador INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN acesso_ate TEXT;   -- AAAA-MM-DD; depois dessa data o login é recusado (NULL = sem prazo)
UPDATE meta SET valor = '7' WHERE chave = 'schema_versao';

-- ---------- v8 ----------
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
