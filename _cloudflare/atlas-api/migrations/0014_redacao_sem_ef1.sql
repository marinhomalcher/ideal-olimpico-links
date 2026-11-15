-- v14: o EF1 sai da Redação (decisão do Marinho, 15/11/2026). Apaga turmas e alunos do EF1.
-- Turma de EF1 que já tenha lote enviado é mantida, por segurança. A importação passa a ignorar o EF1.
DELETE FROM redacao_professor_turmas WHERE turma_id IN (SELECT id FROM redacao_turmas WHERE segmento = 'EF1');
DELETE FROM redacao_alunos WHERE segmento = 'EF1';
DELETE FROM redacao_turmas WHERE segmento = 'EF1' AND id NOT IN (SELECT turma_id FROM redacao_lotes);

UPDATE meta SET valor = '14' WHERE chave = 'schema_versao';
