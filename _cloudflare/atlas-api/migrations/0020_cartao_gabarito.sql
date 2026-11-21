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
