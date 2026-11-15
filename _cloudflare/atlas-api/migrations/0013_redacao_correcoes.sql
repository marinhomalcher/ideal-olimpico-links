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
