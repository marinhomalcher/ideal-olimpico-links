-- v23: etapa B da aprovação das provas pelos professores. Só ACRESCENTA uma tabela.
-- Voto "Concordo" do professor em cada questão da seleção (o pedido de mudança fica em avaliacao_pedidos).
-- Serve para a etapa C saber quem aprovou uma questão que depois foi alterada e precisa reaprovar.
CREATE TABLE avaliacao_votos (
  selecao_id   INTEGER NOT NULL REFERENCES selecoes(id) ON DELETE CASCADE,
  professor_id INTEGER NOT NULL REFERENCES usuarios(id),
  item_id      INTEGER NOT NULL REFERENCES itens(id),
  voto         TEXT NOT NULL DEFAULT 'concordo' CHECK (voto IN ('concordo')),
  em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (selecao_id, professor_id, item_id)
);

UPDATE meta SET valor = '23' WHERE chave = 'schema_versao';
