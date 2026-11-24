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

-- ---------- v9 ----------
-- ATLAS schema v9: classificadores (força-tarefa) — professor marcado pelo ADM classifica as questões do ADM/digitador.
ALTER TABLE usuarios ADD COLUMN classificador INTEGER NOT NULL DEFAULT 0;
-- Reserva da questão entregue pelo botão "Próxima questão" (uma por vez; vence sozinha depois de 2 horas).
CREATE TABLE IF NOT EXISTS reservas (
  item_id     INTEGER PRIMARY KEY REFERENCES itens(id),
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  expira_em   INTEGER NOT NULL                -- segundos desde 1970 (UTC)
);
CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(usuario_id);
UPDATE meta SET valor = '9' WHERE chave = 'schema_versao';

-- ---------- v10 ----------
-- Redação: turmas, alunos e permissões da equipe. Sem notas nem PDFs nesta etapa.
CREATE TABLE redacao_turmas (
  id INTEGER PRIMARY KEY,
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  unidade TEXT NOT NULL CHECK (unidade IN ('BC','AM','CN')),
  segmento TEXT NOT NULL CHECK (segmento IN ('EF1','EF2','EM')),
  serie TEXT NOT NULL,
  codigo TEXT NOT NULL,
  ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0,1)),
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (ano, unidade, segmento, serie, codigo)
);
CREATE INDEX idx_redacao_turmas_local ON redacao_turmas (ano, unidade, segmento, serie);

CREATE TABLE redacao_alunos (
  ra TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  turma_id INTEGER NOT NULL REFERENCES redacao_turmas(id),
  ano INTEGER NOT NULL,
  segmento TEXT NOT NULL,
  serie TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_redacao_alunos_turma ON redacao_alunos (turma_id, nome);

CREATE TABLE redacao_equipe (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id),
  funcao TEXT NOT NULL CHECK (funcao IN ('professor','digitalizador')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);
CREATE TABLE redacao_professor_turmas (
  usuario_id INTEGER NOT NULL REFERENCES redacao_equipe(usuario_id),
  turma_id INTEGER NOT NULL REFERENCES redacao_turmas(id),
  PRIMARY KEY (usuario_id, turma_id)
);
CREATE INDEX idx_redacao_professor_turmas_turma ON redacao_professor_turmas (turma_id);
CREATE TABLE redacao_digitalizador_unidades (
  usuario_id INTEGER NOT NULL REFERENCES redacao_equipe(usuario_id),
  unidade TEXT NOT NULL CHECK (unidade IN ('BC','AM','CN')),
  PRIMARY KEY (usuario_id, unidade)
);

CREATE TABLE redacao_importacoes (
  id INTEGER PRIMARY KEY,
  ano INTEGER NOT NULL,
  administrador TEXT NOT NULL,
  linhas INTEGER NOT NULL,
  novos INTEGER NOT NULL,
  atualizados INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO redacao_turmas (ano, unidade, segmento, serie, codigo)
VALUES
 (2026,'BC','EM','1ª Série','1EMA'), (2026,'BC','EM','2ª Série','2EMA'), (2026,'BC','EM','3ª Série','3EMA'),
 (2026,'AM','EM','1ª Série','1EMA'), (2026,'AM','EM','2ª Série','2EMA'), (2026,'AM','EM','3ª Série','3EMA'),
 (2026,'CN','EM','1ª Série','1EMA'), (2026,'CN','EM','2ª Série','2EMA'), (2026,'CN','EM','3ª Série','3EMA'),
 (2026,'BC','EM','1ª Série','1MED'), (2026,'BC','EM','2ª Série','2MED'), (2026,'BC','EM','3ª Série','3MED'),
 (2026,'CN','EM','1ª Série','1MED'), (2026,'CN','EM','2ª Série','2MED'), (2026,'CN','EM','3ª Série','3MED');

UPDATE meta SET valor = '10' WHERE chave = 'schema_versao';

-- ---------- v11 ----------
-- Redação: recebimento de um PDF por bimestre e turma, com histórico de cancelamento.
CREATE TABLE redacao_lotes (
  id INTEGER PRIMARY KEY,
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  bimestre INTEGER NOT NULL CHECK (bimestre BETWEEN 1 AND 4),
  turma_id INTEGER NOT NULL REFERENCES redacao_turmas(id),
  digitalizador_id INTEGER NOT NULL REFERENCES usuarios(id),
  r2_key TEXT NOT NULL UNIQUE,
  nome_arquivo TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 52428800),
  enviado_em TEXT NOT NULL,
  cancelavel_ate TEXT NOT NULL,
  cancelado_em TEXT,
  cancelado_por TEXT,
  arquivo_excluido_em TEXT
);
CREATE UNIQUE INDEX idx_redacao_lotes_ativo
  ON redacao_lotes (ano, bimestre, turma_id)
  WHERE cancelado_em IS NULL;
CREATE INDEX idx_redacao_lotes_turma ON redacao_lotes (turma_id, bimestre, enviado_em);
CREATE INDEX idx_redacao_lotes_pendentes ON redacao_lotes (cancelado_em, arquivo_excluido_em);

UPDATE meta SET valor = '11' WHERE chave = 'schema_versao';

-- ---------- v12 ----------
-- v12: índice das páginas de cada lote de Redação (uma folha por aluno, só frente).
-- O PDF continua inteiro no R2; aqui fica o que foi lido em cada página e a quem ela pertence.
CREATE TABLE redacao_paginas (
  lote_id INTEGER NOT NULL REFERENCES redacao_lotes(id),
  pagina INTEGER NOT NULL CHECK (pagina BETWEEN 1 AND 400),
  ra_lido TEXT,                                   -- RA do código de barras (NULL = sem código)
  angulo REAL NOT NULL DEFAULT 0,                 -- giro aplicado para endireitar (graus)
  invertida INTEGER NOT NULL DEFAULT 0 CHECK (invertida IN (0,1)),
  marcadores INTEGER NOT NULL DEFAULT 0 CHECK (marcadores BETWEEN 0 AND 4),
  situacao TEXT NOT NULL CHECK (situacao IN ('aluno','avulsa','duvida','descartada')),
  motivo TEXT CHECK (motivo IS NULL OR motivo IN ('outra_turma','outra_unidade','fora_cadastro','repetido')),
  aluno_ra TEXT,                                  -- aluno atribuído (situacao = 'aluno')
  resolvido_por TEXT,
  resolvido_em TEXT,
  PRIMARY KEY (lote_id, pagina)
);
CREATE INDEX idx_redacao_paginas_situacao ON redacao_paginas (situacao, lote_id);
CREATE INDEX idx_redacao_paginas_aluno ON redacao_paginas (aluno_ra);

UPDATE meta SET valor = '12' WHERE chave = 'schema_versao';

-- ---------- v13 ----------
-- v13: correção das redações pela professora (uma linha por página corrigida ou condenada).
CREATE TABLE redacao_correcoes (
  lote_id INTEGER NOT NULL REFERENCES redacao_lotes(id),
  pagina INTEGER NOT NULL,
  aluno_ra TEXT NOT NULL,
  professor_id INTEGER NOT NULL REFERENCES usuarios(id),
  c1 INTEGER CHECK (c1 IS NULL OR c1 IN (0,40,80,120,160,200)),
  c2 INTEGER CHECK (c2 IS NULL OR c2 IN (40,80,120,160,200)),
  c3 INTEGER CHECK (c3 IS NULL OR c3 IN (0,40,80,120,160,200)),
  c4 INTEGER CHECK (c4 IS NULL OR c4 IN (0,40,80,120,160,200)),
  c5 INTEGER CHECK (c5 IS NULL OR c5 IN (0,40,80,120,160,200)),
  total INTEGER CHECK (total IS NULL OR total BETWEEN 0 AND 1000),
  zero_motivo TEXT,                 -- nota zero na redação inteira (C1–C5 ficam vazias)
  c5_motivo TEXT,                   -- motivo quando só a C5 é zero
  observacao TEXT,
  condenada INTEGER NOT NULL DEFAULT 0 CHECK (condenada IN (0,1)),
  condenada_motivo TEXT,
  segundos INTEGER NOT NULL DEFAULT 0 CHECK (segundos BETWEEN 0 AND 86400),  -- tempo da 1ª correção
  enviada_em TEXT NOT NULL,
  revisada_em TEXT,
  PRIMARY KEY (lote_id, pagina)
);
CREATE INDEX idx_redacao_correcoes_aluno ON redacao_correcoes (aluno_ra);
CREATE INDEX idx_redacao_correcoes_professor ON redacao_correcoes (professor_id, enviada_em);

UPDATE meta SET valor = '13' WHERE chave = 'schema_versao';

-- ---------- v14 ----------
-- v14: o EF1 sai da Redação (decisão do Marinho, 15/11/2026). Apaga turmas e alunos do EF1.
-- Turma de EF1 que já tenha lote enviado é mantida, por segurança. A importação passa a ignorar o EF1.
DELETE FROM redacao_professor_turmas WHERE turma_id IN (SELECT id FROM redacao_turmas WHERE segmento = 'EF1');
DELETE FROM redacao_alunos WHERE segmento = 'EF1';
DELETE FROM redacao_turmas WHERE segmento = 'EF1' AND id NOT IN (SELECT turma_id FROM redacao_lotes);

UPDATE meta SET valor = '14' WHERE chave = 'schema_versao';

-- ---------- v15 ----------
-- v15: cadastro único de pessoas ("Cadastros e funções"). Uma pessoa pode ter várias funções.
-- Redação: professor de redação e digitalizador viram marcações independentes (antes era uma função só).
ALTER TABLE redacao_equipe ADD COLUMN professor INTEGER NOT NULL DEFAULT 0 CHECK (professor IN (0,1));
ALTER TABLE redacao_equipe ADD COLUMN digitalizador INTEGER NOT NULL DEFAULT 0 CHECK (digitalizador IN (0,1));
UPDATE redacao_equipe SET professor = CASE WHEN funcao = 'professor' THEN 1 ELSE 0 END,
                          digitalizador = CASE WHEN funcao = 'digitalizador' THEN 1 ELSE 0 END;
-- Coordenadores: recebem o Excel das notas da unidade/segmento/série que coordenam.
CREATE TABLE coordenadores (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  unidade TEXT NOT NULL CHECK (unidade IN ('BC','AM','CN')),
  segmento TEXT NOT NULL CHECK (segmento IN ('EF2','EM')),
  serie TEXT NOT NULL,
  PRIMARY KEY (usuario_id, unidade, segmento, serie)
);

UPDATE meta SET valor = '15' WHERE chave = 'schema_versao';

-- ---------- v16 ----------
-- v16: marca-texto na correção da redação. Os destaques da professora ficam guardados com a correção
-- da página (lista JSON de faixas em coordenadas da folha alinhada, de 0 a 1), para o espelho do aluno.
-- O PDF original não é alterado.
ALTER TABLE redacao_correcoes ADD COLUMN marcacoes TEXT;

UPDATE meta SET valor = '16' WHERE chave = 'schema_versao';

-- ---------- v17 ----------
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

-- ---------- v18 ----------
-- v18: "Meu desempenho" do portal do aluno (aprovado pelo Marinho em 17/11/2026).
-- Cada linha é um documento de um aluno: mapa de desempenho de uma prova (Simulado Particulares, ENEM 1º dia,
-- ENEM 2º dia) ou o espelho da redação, de um bimestre. As páginas ficam como imagens JPEG no SharePoint
-- "Resultados IDEAL OLÍMPICO" (<ano>/B<bimestre>/<prova>/<RA>/p<n>.jpg). O aluno só vê depois de liberado.
-- Guarda: só o ano corrente (o encerramento de 31/12 apaga linhas e imagens do ano).
CREATE TABLE desempenho_documentos (
  id INTEGER PRIMARY KEY,
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  bimestre INTEGER NOT NULL CHECK (bimestre BETWEEN 1 AND 4),
  prova TEXT NOT NULL CHECK (prova IN ('PART','ENEM1','ENEM2','ESPELHO')),
  ra TEXT NOT NULL,
  paginas INTEGER NOT NULL CHECK (paginas BETWEEN 1 AND 40),
  lote_id INTEGER,
  enviado_em TEXT NOT NULL,
  enviado_por TEXT NOT NULL,
  liberado_em TEXT,
  UNIQUE (ano, bimestre, prova, ra)
);
CREATE INDEX idx_desempenho_ra ON desempenho_documentos (ra, ano);
CREATE INDEX idx_desempenho_prova ON desempenho_documentos (ano, bimestre, prova);

UPDATE meta SET valor = '18' WHERE chave = 'schema_versao';

-- ---------- v19 ----------
-- v19: cadastro completo de alunos (pedido do Marinho em 21/11/2026): o ATLAS passa a ser a base dos dados do
-- aluno que o Portal mostra e confirma. Uma linha por RA, com as 15 colunas da planilha da escola
-- (NOME COMPLETO, RA, FILIAL, SÉRIE, CODTURMA, SEGMENTO, SEXO, DAT_NASC, IDADE, CPF, EMAIL INSTITUCIONAL ALUNO,
-- EMAIL PESSOAL ALUNO, RESPONSÁVEL FINANCEIRO, EMAIL PESSOAL RESPONSÁVEL, TELEFONE; a idade é calculada) e os campos
-- que o aluno preenche no Portal (WhatsApp do aluno, vínculo e WhatsApp do responsável, data da confirmação).
-- Inclui o EF1 (a Redação continua usando só redacao_alunos, com EF2 e EM).
CREATE TABLE alunos (
  ra TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  unidade TEXT NOT NULL CHECK (unidade IN ('BC','AM','CN')),
  serie TEXT NOT NULL,
  turma TEXT NOT NULL,
  segmento TEXT NOT NULL CHECK (segmento IN ('EF1','EF2','EM')),
  sexo TEXT NOT NULL DEFAULT '',
  nascimento TEXT NOT NULL DEFAULT '',
  cpf TEXT NOT NULL DEFAULT '',
  email_institucional TEXT NOT NULL DEFAULT '',
  email_pessoal TEXT NOT NULL DEFAULT '',
  responsavel TEXT NOT NULL DEFAULT '',
  responsavel_email TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  whatsapp_aluno TEXT NOT NULL DEFAULT '',
  responsavel_vinculo TEXT NOT NULL DEFAULT '',
  responsavel_whatsapp TEXT NOT NULL DEFAULT '',
  confirmado_em TEXT,
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_alunos_turma ON alunos (unidade, segmento, serie, turma, nome);

UPDATE meta SET valor = '19' WHERE chave = 'schema_versao';

-- ---------- v20 ----------
-- v20: gabarito oficial por cima do cartão-resposta (pedido do Marinho em 21/11/2026).
-- O documento de desempenho ganha a série e a trilha (MED ou REG) da prova, as respostas do aluno (uma letra por
-- questão, vindas da planilha de correção: "_" em branco, "*" dupla marcação) e a grade das bolhas de cada
-- página (JSON de atlas-cartao.js), para o portal desenhar o gabarito por cima da imagem.
-- O gabarito é um por bimestre, prova, série e trilha: JSON de respostas ("A", "X" anulada, "A/C" duas certas)
-- e o número da primeira questão (1 no regular, 91 no 2º dia do ENEM).
ALTER TABLE desempenho_documentos ADD COLUMN serie TEXT;
ALTER TABLE desempenho_documentos ADD COLUMN trilha TEXT CHECK (trilha IS NULL OR trilha IN ('MED','REG'));
ALTER TABLE desempenho_documentos ADD COLUMN respostas TEXT;
ALTER TABLE desempenho_documentos ADD COLUMN cartoes TEXT;
CREATE TABLE desempenho_gabaritos (
  id INTEGER PRIMARY KEY,
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  bimestre INTEGER NOT NULL CHECK (bimestre BETWEEN 1 AND 4),
  prova TEXT NOT NULL CHECK (prova IN ('PART','ENEM1','ENEM2')),
  serie TEXT NOT NULL,
  trilha TEXT NOT NULL CHECK (trilha IN ('MED','REG')),
  inicio INTEGER NOT NULL CHECK (inicio BETWEEN 1 AND 999),
  respostas TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  atualizado_por TEXT NOT NULL,
  UNIQUE (ano, bimestre, prova, serie, trilha)
);

UPDATE meta SET valor = '20' WHERE chave = 'schema_versao';

-- ---------- v21 ----------
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
