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
