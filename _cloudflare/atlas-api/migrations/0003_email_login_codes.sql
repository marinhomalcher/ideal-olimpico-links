-- ATLAS: códigos temporários de acesso e limites de tentativa.
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
