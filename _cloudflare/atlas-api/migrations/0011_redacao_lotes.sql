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
