-- ATLAS: pedidos de conserto (Supervisor -> ADM) para questões já aprovadas.
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
