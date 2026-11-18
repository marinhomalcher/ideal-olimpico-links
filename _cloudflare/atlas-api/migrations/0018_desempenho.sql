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
