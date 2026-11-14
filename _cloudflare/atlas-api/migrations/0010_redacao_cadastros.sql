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
