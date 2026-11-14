-- ATLAS schema v9: classificadores (força-tarefa) — professor marcado pelo ADM classifica as questões do ADM/digitador.
ALTER TABLE usuarios ADD COLUMN classificador INTEGER NOT NULL DEFAULT 0;
-- Reserva da questão entregue pelo botão "Próxima questão" (uma por vez; vence sozinha depois de 2 horas).
CREATE TABLE IF NOT EXISTS reservas (
  item_id     INTEGER PRIMARY KEY REFERENCES itens(id),
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  expira_em   INTEGER NOT NULL                -- segundos desde 1970 (UTC)
);
CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(usuario_id);
UPDATE meta SET valor = '9' WHERE chave = 'schema_versao';
