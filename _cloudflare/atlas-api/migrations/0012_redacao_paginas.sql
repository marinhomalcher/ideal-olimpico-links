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
