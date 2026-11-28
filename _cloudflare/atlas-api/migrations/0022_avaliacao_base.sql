-- v22: base da aprovação das provas pelos professores (decisões do Marinho em 27/11/2026).
-- Só ACRESCENTA: séries do professor, fase de avaliação na seleção, calendário de dias não úteis e as tabelas das etapas seguintes
-- (avaliações, visualizações, pedidos e a conversa com a tréplica). Nada existente é apagado nem refeito.

-- Séries em que cada professor leciona: define quais provas ele precisa avaliar (da sua disciplina, em qualquer turma da série).
CREATE TABLE professor_series (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  serie      INTEGER NOT NULL CHECK (serie IN (1,2,3)),
  PRIMARY KEY (usuario_id, serie)
);

-- Fase da seleção depois que o supervisor finaliza: 'avaliacao' (professores avaliando) e 'liberada' (supervisor pode enviar ao Diagramador).
-- A situação ('rascunho', 'enviada', 'aplicada') continua como está; 'enviada' só vem depois do botão "Enviar para o diagramador".
ALTER TABLE selecoes ADD COLUMN fase TEXT CHECK (fase IN ('avaliacao','liberada'));
ALTER TABLE selecoes ADD COLUMN avaliacao_aberta_em TEXT;
ALTER TABLE selecoes ADD COLUMN avaliacao_prazo_em TEXT;     -- 3 dias úteis depois de abrir
ALTER TABLE selecoes ADD COLUMN liberada_em TEXT;

-- Calendário da escola (empresa privada): dias que NÃO contam como úteis nos prazos. ativo = 1 conta como não útil;
-- ativo = 0 é ponto facultativo que conta como útil (fica na lista para o ADM poder ligar).
CREATE TABLE dias_nao_uteis (
  data   TEXT PRIMARY KEY CHECK (data GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  motivo TEXT NOT NULL,
  ativo  INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

-- Uma linha por professor que precisa avaliar a seleção.
CREATE TABLE avaliacao_professores (
  selecao_id        INTEGER NOT NULL REFERENCES selecoes(id) ON DELETE CASCADE,
  professor_id      INTEGER NOT NULL REFERENCES usuarios(id),
  visto_ate         INTEGER NOT NULL DEFAULT 0,          -- maior número de questão já aberta
  visto_completo_em TEXT,                                 -- quando chegou à última questão ("viu a prova")
  decisao           TEXT NOT NULL DEFAULT 'pendente' CHECK (decisao IN ('pendente','aprovou','pediu_mudanca','dispensado')),
  decidido_em       TEXT,
  dispensado_por    TEXT,
  dispensado_em     TEXT,
  avisado_em        TEXT,
  lembrete_em       TEXT,
  PRIMARY KEY (selecao_id, professor_id)
);

-- Registro de cada questão aberta pelo professor (base do "viu" e do relatório).
CREATE TABLE avaliacao_visualizacoes (
  id           INTEGER PRIMARY KEY,
  selecao_id   INTEGER NOT NULL REFERENCES selecoes(id) ON DELETE CASCADE,
  professor_id INTEGER NOT NULL REFERENCES usuarios(id),
  item_id      INTEGER NOT NULL REFERENCES itens(id),
  em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_aval_visualizacoes ON avaliacao_visualizacoes(selecao_id, professor_id);

-- Pedido de mudança do professor, com prazo de 24 h corridas para cada resposta e a tréplica.
CREATE TABLE avaliacao_pedidos (
  id            INTEGER PRIMARY KEY,
  selecao_id    INTEGER NOT NULL REFERENCES selecoes(id) ON DELETE CASCADE,
  professor_id  INTEGER NOT NULL REFERENCES usuarios(id),
  item_id       INTEGER NOT NULL REFERENCES itens(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('trocar','corrigir')),
  texto         TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','respondido','aceito','aceito_auto','treplica','adm','decidido_adm')),
  prazo_em      TEXT,
  rodada        INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_aval_pedidos ON avaliacao_pedidos(selecao_id, estado);

CREATE TABLE avaliacao_mensagens (
  id        INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES avaliacao_pedidos(id) ON DELETE CASCADE,
  autor     TEXT NOT NULL CHECK (autor IN ('professor','supervisor','adm','sistema')),
  tipo      TEXT NOT NULL CHECK (tipo IN ('pedido','ajustei','mantido','aceite','aceite_auto','treplica','decisao_adm')),
  texto     TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_aval_mensagens ON avaliacao_mensagens(pedido_id);

-- Calendário padrão de 2026 e 2027 (regras decididas em 27/11/2026; o ADM liga e desliga cada dia na tela do calendário).
INSERT INTO dias_nao_uteis (data, motivo, ativo) VALUES
  ('2026-01-01', 'Confraternização Universal', 1),
  ('2026-01-02', 'Ponto facultativo depois do Ano Novo', 1),
  ('2026-01-12', 'Aniversário de Belém', 1),
  ('2026-02-16', 'Carnaval (segunda-feira)', 1),
  ('2026-02-17', 'Carnaval (terça-feira)', 1),
  ('2026-02-18', 'Quarta-feira de Cinzas', 1),
  ('2026-04-02', 'Quinta-feira Santa', 0),
  ('2026-04-03', 'Sexta-feira Santa', 1),
  ('2026-04-21', 'Tiradentes', 1),
  ('2026-05-01', 'Dia do Trabalho', 1),
  ('2026-06-04', 'Corpus Christi', 0),
  ('2026-06-05', 'Emenda do Corpus Christi', 0),
  ('2026-08-15', 'Adesão do Grão-Pará à Independência', 1),
  ('2026-09-07', 'Independência do Brasil', 1),
  ('2026-10-12', 'Nossa Senhora Aparecida e segunda-feira depois do Círio', 1),
  ('2026-10-26', 'Recírio', 1),
  ('2026-10-28', 'Dia do Servidor Público', 0),
  ('2026-11-02', 'Finados', 1),
  ('2026-11-15', 'Proclamação da República', 1),
  ('2026-11-20', 'Consciência Negra', 1),
  ('2026-12-25', 'Natal', 1),
  ('2027-01-01', 'Confraternização Universal', 1),
  ('2027-01-02', 'Ponto facultativo depois do Ano Novo', 1),
  ('2027-01-12', 'Aniversário de Belém', 1),
  ('2027-02-08', 'Carnaval (segunda-feira)', 1),
  ('2027-02-09', 'Carnaval (terça-feira)', 1),
  ('2027-02-10', 'Quarta-feira de Cinzas', 1),
  ('2027-03-25', 'Quinta-feira Santa', 0),
  ('2027-03-26', 'Sexta-feira Santa', 1),
  ('2027-04-21', 'Tiradentes', 1),
  ('2027-05-01', 'Dia do Trabalho', 1),
  ('2027-05-27', 'Corpus Christi', 0),
  ('2027-05-28', 'Emenda do Corpus Christi', 0),
  ('2027-08-15', 'Adesão do Grão-Pará à Independência', 1),
  ('2027-09-07', 'Independência do Brasil', 1),
  ('2027-10-11', 'Segunda-feira depois do Círio', 1),
  ('2027-10-12', 'Nossa Senhora Aparecida', 1),
  ('2027-10-25', 'Recírio', 1),
  ('2027-10-28', 'Dia do Servidor Público', 0),
  ('2027-11-02', 'Finados', 1),
  ('2027-11-15', 'Proclamação da República', 1),
  ('2027-11-20', 'Consciência Negra', 1),
  ('2027-12-25', 'Natal', 1);

UPDATE meta SET valor = '22' WHERE chave = 'schema_versao';
