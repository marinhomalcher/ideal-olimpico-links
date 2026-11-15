-- v16: marca-texto na correção da redação. Os destaques da professora ficam guardados com a correção
-- da página (lista JSON de faixas em coordenadas da folha alinhada, de 0 a 1), para o espelho do aluno.
-- O PDF original não é alterado.
ALTER TABLE redacao_correcoes ADD COLUMN marcacoes TEXT;

UPDATE meta SET valor = '16' WHERE chave = 'schema_versao';
