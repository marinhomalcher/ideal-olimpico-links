-- v15: cadastro único de pessoas ("Cadastros e funções"). Uma pessoa pode ter várias funções.
-- Redação: professor de redação e digitalizador viram marcações independentes (antes era uma função só).
ALTER TABLE redacao_equipe ADD COLUMN professor INTEGER NOT NULL DEFAULT 0 CHECK (professor IN (0,1));
ALTER TABLE redacao_equipe ADD COLUMN digitalizador INTEGER NOT NULL DEFAULT 0 CHECK (digitalizador IN (0,1));
UPDATE redacao_equipe SET professor = CASE WHEN funcao = 'professor' THEN 1 ELSE 0 END,
                          digitalizador = CASE WHEN funcao = 'digitalizador' THEN 1 ELSE 0 END;
-- Coordenadores: recebem o Excel das notas da unidade/segmento/série que coordenam.
CREATE TABLE coordenadores (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  unidade TEXT NOT NULL CHECK (unidade IN ('BC','AM','CN')),
  segmento TEXT NOT NULL CHECK (segmento IN ('EF2','EM')),
  serie TEXT NOT NULL,
  PRIMARY KEY (usuario_id, unidade, segmento, serie)
);

UPDATE meta SET valor = '15' WHERE chave = 'schema_versao';
