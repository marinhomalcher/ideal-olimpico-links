-- ATLAS schema v7: digitador (só envia questões, sem classificar) e acesso com data de término.
ALTER TABLE usuarios ADD COLUMN digitador INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN acesso_ate TEXT;   -- AAAA-MM-DD; depois dessa data o login é recusado (NULL = sem prazo)
UPDATE meta SET valor = '7' WHERE chave = 'schema_versao';
