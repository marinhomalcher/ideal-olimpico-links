# ATLAS — continuidade (para o assistente que pegar o trabalho)

Atualizado em **14/11/2026**, depois das migrações automáticas do D1 no deploy e do merge feito pelo assistente. Responsável: **Marinho (João Marinho Malcher), Grupo Ideal**. O ADM é só ele.

Leia isto inteiro antes de mexer. Converse com o Marinho **sempre em português**, passo a passo, com **link direto**, sem jargão ("console", "branch") sem explicar.

## 1. O que é e onde está

ATLAS = banco de questões (BQI) do Grupo Ideal. Professor cadastra → Supervisor da disciplina analisa (aprova, pede ajuste, edita, descarta) → questão aprovada vai para seleções de provas.

| Peça | Onde |
|---|---|
| Telas | https://idealolimpico.com.br/atlas/ (GitHub Pages; pasta `atlas/`) |
| Servidor | Cloudflare Worker `atlas-api` (`_cloudflare/atlas-api/worker.js`), publicado sozinho a cada merge na `main` |
| Banco | Cloudflare D1 `atlas-teste` (será o oficial). **Schema v10** |
| Imagens e cópias | R2 `atlas-imagens` (`img/` imagens, `backups/` cópia diária 3h17 de Brasília) |
| E-mails | Microsoft Graph como `olimpiadas@grupoideal.com.br`; reserva: Apps Script (`ATLAS_MAILER_URL`) |
| Portal de inscrições | mesmo repositório (`index.html`, `inscricoes/`, `teste-inscricoes/`) — **NÃO MEXER** |

O repositório é **público**: nada de segredo no código. Segredos só no painel da Cloudflare / Propriedades do Apps Script.

## 2. Como entregar uma mudança

- **Só um assistente por vez** (Claude ou ChatGPT/Codex; regra de 14/11/2026). Antes de começar: puxe a `main` atualizada, confira se há PR aberto de outro assistente e não mexa nos mesmos arquivos; se houver dúvida, pergunte ao Marinho. Branches: Claude usa `claude/...`, Codex usa `codex/...`; nunca reaproveite a do outro. Conflito no merge: atualize a branch a partir da `main`, rode os testes de novo, nunca force.
0. **Nada é implementado nem publicado sem autorização do Marinho** (regra de 14/11/2026). Antes, apresente as opções com prós e contras (de preferência como perguntas de marcar, item por item) e espere o "pode fazer". Vale para código, banco, telas e até mudanças só de texto.
1. Branch nova a partir da `main` → commit → PR. **Nunca** commit direto na `main`. **O próprio assistente faz o merge** (autorizado pelo Marinho em 13/11/2026), depois dos testes passarem, e conta ao Marinho o que foi ao ar.
2. Mudou alguma coisa em `atlas/`? Rode `python3 _cloudflare/atlas-api/nova-versao.py AAAAMMDDx` (nova versão a cada entrega). As páginas abertas se recarregam sozinhas.
3. Mudou o banco? Crie `migrations/000N_*.sql` (número seguinte), acrescente o mesmo bloco no fim de `schema.sql` (`-- ---------- vN ----------`), suba `meta.schema_versao`. **O SQL é aplicado sozinho no merge**: o comando de implantação do Worker na Cloudflare (Workers & Pages → atlas-api → Settings → Build → Deploy command) é
   `npx wrangler d1 migrations apply atlas-teste --remote && npx wrangler deploy`
   — aplica as migrações pendentes (controle na tabela `d1_migrations` do banco) e só então publica o Worker; se uma migração falhar, nada é publicado e o Worker antigo continua no ar. O comando das branches que não são a `main` **não** aplica migrações. Regras: nunca edite nem renomeie uma migração já mergeada (crie outra); escreva o SQL para rodar uma vez só, de ponta a ponta; diga no PR e ao Marinho que há migração. As migrações 0003–0008 foram aplicadas à mão antes disso e marcadas como aplicadas em `d1_migrations`. Ao zerar o banco, mantenha também `d1_migrations`.
4. Rode os testes (abaixo) antes de abrir o PR. Depois do merge, confira que `main` ficou igual à sua branch e que a implantação do `atlas-api` apareceu na Cloudflare (o Marinho pode mandar print de Workers e Pages → atlas-api → Implantações).

## 3. Testes

`_cloudflare/atlas-api/testes/` — 23 suítes. Usam SQLite real (`node:sqlite`) no lugar do D1, R2 falso em memória e Playwright (Chromium) nas telas. Nenhum e-mail real sai. `rodar.sh` retorna erro se qualquer suíte falhar; o GitHub Actions também o executa em Linux em cada PR do ATLAS.

```
cd _cloudflare/atlas-api/testes && ./rodar.sh            # todas
./rodar.sh itens retirada                                # só algumas
```

Ambiente: Node 22+ (usa `node:sqlite`), npm com internet e Playwright com Chromium. Instale o Playwright **fora do repositório** (não há `.gitignore`): `npm install --prefix /tmp/pw playwright && npx --prefix /tmp/pw playwright install --with-deps chromium && export NODE_PATH=/tmp/pw/node_modules`. Todas as suítes usam a data fixa 13/11/2026 (`ATLAS_HOJE_TESTE`). `preparar.sh` baixa KaTeX e ExcelJS via npm para `$ATLAS_TESTE_TMP` (padrão `/tmp/atlas-testes`). Os testes de seleções/edição às vezes falham por tempo de tela: rode de novo antes de investigar. Todas as suítes usam a data fixa 13/11/2026 (`ATLAS_HOJE_TESTE`), para não falharem nas férias; o navegador da suíte `ferias` também tem o relógio fixo. Ao mudar a versão do schema, atualize as verificações "Schema N" em `teste-adm`, `teste-login` e `teste-selecoes`.

## 4. Regras do Marinho (valem sempre)

- Só e-mail `@grupoideal.com.br`, sem exceção nem subdomínio. ADM entra com Google (só `ADMIN_EMAIL`); os demais com código de 6 dígitos por e-mail.
- Sem `confirm()`/`alert()`/`prompt()` (o app do Claude bloqueia): confirmações dentro da página.
- Testes nunca mandam e-mail real a professor.
- Excel: números centralizados. Arquivos revisados mantêm o mesmo nome.
- **O banco está em TESTE.** Só zerar quando o Marinho pedir; quando ele pedir, é para zerar (manter usuários, `meta`, `d1_migrations`, `backups/`; fazer cópia antes).
- Supervisor: edita texto, tags, assunto, subtema e Bloom; **não** muda etapa, origem, fonte nem dificuldade (só preenche dificuldade se estiver vazia). Dificuldade é ajustada pela escola depois da pré-testagem.
- Só o ADM: desfaz descarte (30 dias), corrige questão aprovada, faz consertos pedidos pelo Supervisor.
- Tags: professor é obrigado a pôr pelo menos 2 (máx. 12).
- **Férias:** professor e supervisor ficam fora em julho e no recesso de 15/12 a 31/01; o **digitador só em julho** (trabalha no recesso). Horário de Brasília. ADM entra sempre. Tela grande "FÉRIAS".
- Reconhecimento de questão por print/OCR: **descartado** (não há IA para isso). Importar provas antigas do Word continua como opção futura.
- Hospedagem: não tirar do GitHub Pages (o portal de inscrições está junto).

## 5. Funcionalidades prontas

- Professor: questão única ou grupo/testlet (2–10 questões com o mesmo texto-base), editor com imagens (R2) e LaTeX, colar alternativas juntas no comando ou no campo A (A) / a) / A. / A[tab] / letra sozinha na linha / "A texto" — este último só com letra maiúscula e a sequência A–E completa, valendo o último "A " do texto), referência com "Acesso em:" sempre na linha de baixo, aviso de questão repetida (assinatura SHA-256), rascunho guardado se o login vencer, quadro **Meu resumo** (mês/ano, filtro de mês).
- Supervisor: fila com selos "possível repetida" e "CLASSIFICAR", decisões, edição, pedido de conserto ao ADM, seleções para provas (série 1ª–3ª × REG/MED; grupo entra inteiro).
- ADM: cadastros (professor, supervisor por disciplina, **digitador** com prazo de acesso), Questões (busca por código, desfazer descarte, consertos), **Enviar questões** (sem classificação, origem fixa "Acervo Ideal", sem tags), **Relatório de produção** (por professor/mês; filtros todos/área LC-CH-CN-MT/disciplina/professor; Excel), Seleções recebidas, cópias de segurança, **retirada das questões autorais de professor desligado** (professor desativado + 3 etapas; 6 meses para devolver; vencido o prazo, e-mail e alerta ao ADM; exclusão definitiva faz cópia antes e mantém questões que estão em provas montadas).
- Digitador: entra como professor e cai em `digitador.html`; envia por disciplina, sem classificar.
- Questões do ADM/digitador: aprovação bloqueada até haver assunto, Bloom, dificuldade e ≥ 2 tags; sem "pedir ajuste" e sem e-mail.
- **Código provisório X** (14/11/2026): questão do ADM ou do digitador nasce com `X` + 7 números; na aprovação o X vira a letra da disciplina, com os mesmos números (evento `codigo_definitivo` guarda o anterior; a busca do ADM acha pelo X). Os números nunca se repetem entre letras (`sortearCodigoLivre`). Questão de professor continua com a letra da disciplina desde o envio.
- **Sem disciplina** (`itens.disciplina = 'Sem disciplina'`): o digitador pode escolher "Não sei a disciplina"; o supervisor (só em questão do ADM/digitador, em análise) usa "Devolver ao ADM (não é da minha disciplina)", sem sugestão nem motivo. O ADM vê o aviso no painel e o quadro "Questões sem disciplina" em Questões, escolhe a disciplina e a questão vai para a fila do supervisor dela.
- **Classificadores (força-tarefa)** (schema v9; tabela `reservas`, `usuarios.classificador`): professor marcado pelo ADM no cadastro. Na área do professor aparece o cartão "Força-tarefa" → `classificar.html`: "Próxima questão" entrega uma questão do ADM/digitador da disciplina dele ainda sem classificação e a reserva por 2 h (ninguém pega a mesma). Ele preenche assunto/subtema/Bloom/dificuldade/≥ 2 tags, pode corrigir erros de digitação (o evento `item_classificado` guarda o que mudou), pode devolver ao ADM e "Parar por agora" libera a reserva. Não aprova. Fecha no recesso (é professor). Na fila do supervisor as classificadas vêm primeiro com o selo "pronta para aprovar" e um aviso de quem classificou e o que mudou; se discordar, o supervisor edita. Relatório de produção e Excel têm a coluna "Classif.".
- Avisos por e-mail **ligados** (`ATLAS_AVISOS_ATIVOS = "1"`).
- **Vários textos de apoio** (até 4; `dados.textos_extras = [{texto, referencia}]`, o 1º continua em `texto-base`/`referencia`; títulos TEXTO I, II… automáticos), **fonte por alternativa** (`ref-a`…`ref-e`), referências em fonte 8 à direita, e **formato na prova** (`layout` = `coluna` padrão | `pagina`; no grupo vale para todas as questões; mudar só o formato é permitido mesmo com questão do grupo aprovada). Textos II–IV abrem embaixo, em largura total como o Texto I; a referência de cada texto fica atrás do botão "+ Inserir referência do texto ou da imagem" (abre sozinha quando já tem conteúdo). Componente comum: `AtlasRich.extras()` em `atlas-editor.js`.

## 6. Próximos passos combinados

1. **Piloto** com uma disciplina (2–3 professores + supervisor + o digitador Helio). Guias: "Guias do ATLAS para o piloto" (documento no claude.ai do Marinho).
2. Depois do piloto: zerar o banco (só quando ele pedir) e lançar.
3. Ideias em aberto: importar provas antigas do Word; endereço próprio para a API (`api.idealolimpico.com.br`); passar o repositório para uma organização "Grupo Ideal" no GitHub.
4. BQI etapa 2 (depois): importar resultados por planilha, anulações, taxa de acerto por questão. O ATLAS não calcula nota de aluno.
5. **Redação, etapa 1 (schema v10):** entrada Redação na página inicial, portal inicial com turmas/unidades vinculadas e cadastros próprios na área do ADM. Turmas iniciais de EM: 1EMA/2EMA/3EMA nas três unidades, e 1MED/2MED/3MED em BC e CN; outras turmas surgem pelo cadastro manual ou importação. Professores de redação são vinculados às turmas; digitalizadores, às unidades. A planilha completa `NOME COMPLETO, RA, FILIAL, SÉRIE, CODTURMA, SEGMENTO` é conferida antes de importar: RA único, novos alunos cadastrados, nome/turma/unidade atualizados; troca de série ou segmento dentro do mesmo ano bloqueia a importação. Nenhum aluno é apagado por estar ausente de uma atualização. O cadastro anual de alunos é eliminado na virada do ano somente depois de uma cópia diária bem-sucedida. As novas tabelas entram no backup diário do R2. **Ainda não há upload nem correção de redações nesta etapa.**
6. **Redação, etapa 2A (schema v11):** o digitalizador escolhe bimestre/unidade/segmento/série/turma e envia um PDF de até 50 MB. O PDF original fica privado no R2; só digitalizador da unidade e ADM podem abrir. O banco guarda um lote ativo por ano/bimestre/turma; o digitalizador confere o arquivo guardado e pode cancelar seus próprios lotes por 2 horas. O ADM vê todos os lotes e pode cancelar depois desse prazo. O cancelamento libera o slot e remove o PDF, com nova tentativa automática de exclusão se o R2 falhar. Não há e-mail à professora nem correção nesta fase. A visualização usa o leitor de PDF do navegador; não há separação por aluno nesta etapa.
7. **Redação, próximas etapas:** leitura do RA pelo código de barras, separação por aluno e alinhamento pelos marcadores precisam ser validados com um PDF realmente escaneado. Depois vêm correção por competências, exceções, relatórios Excel e backup dos PDFs no OneDrive institucional quando a TI liberar a integração. A professora pode corrigir notas enviadas por competência; o total é recalculado e o Excel corrigido é reenviado. O ADM pode consultar as notas. Aluno que muda de turma/unidade após a avaliação é tratado fora do sistema, por exceção.
