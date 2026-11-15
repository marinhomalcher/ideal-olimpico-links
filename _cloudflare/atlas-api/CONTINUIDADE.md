# ATLAS — continuidade (para o assistente que pegar o trabalho)

Atualizado em **15/11/2026**, depois do PR [#113](https://github.com/marinhomalcher/ideal-olimpico-links/pull/113) (Claude). Responsável: **Marinho (João Marinho Malcher), Grupo Ideal**. O ADM é só ele.

Estado no ar, conferido depois do merge do #113:
- site na versão `20261115n`;
- API com `schema 16`;
- **26 suítes / 1.021 verificações** passando.

Leia isto inteiro antes de mexer. Converse com o Marinho **sempre em português**, passo a passo, em linguagem simples e com **link direto**. Explique os termos técnicos: "branch" é o ramo separado do código, "PR" é o pedido de junção e "merge" é juntar à versão oficial. Ele gosta de **respostas curtas**.

## 1. O que é e onde está

ATLAS = banco de questões (BQI) do Grupo Ideal + módulo de **Redação** (correção das redações das turmas).
- **BQI:** o Professor cadastra a questão, o Supervisor da disciplina analisa, e a questão aprovada vai para as seleções de provas.
- **Redação:** o digitalizador envia o PDF da turma, a professora corrige na tela e as notas ficam guardadas.

| Peça | Onde |
|---|---|
| Telas | https://idealolimpico.com.br/atlas/ (GitHub Pages; pasta `atlas/`) |
| Servidor | Cloudflare Worker `atlas-api` (`worker.js`, `redacao-*.js`, `pessoas.js`), publicado sozinho a cada merge na `main` |
| Banco | Cloudflare D1 `atlas-teste` (será o oficial). **Schema v16** |
| Arquivos | R2 `atlas-imagens`: `img/` (imagens das questões), `redacao/` (PDFs originais, privados), `backups/` (cópia diária do D1 às 3h17 de Brasília, guarda 60) |
| E-mails | Microsoft Graph como `olimpiadas@grupoideal.com.br`; reserva: Apps Script (`ATLAS_MAILER_URL`) |
| Portal de inscrições | mesmo repositório (`index.html`, `inscricoes/`, `teste-inscricoes/`) — **NÃO MEXER** (exceção futura: só o "MEU DESEMPENHO", §7) |

O repositório é **público**: nada de segredo no código, **nenhuma planilha nem PDF real de aluno**. PDFs e planilhas reais só podem ser usados localmente, fora do repositório, e apagados depois.

## 2. Como entregar uma mudança

0. **Nada é implementado nem publicado sem autorização do Marinho.**
   - Antes, apresente as opções com prós e contras, de preferência como **perguntas de marcar**, com a recomendada primeiro e marcada "(Recomendado)".
   - Espere o "pode fazer" (ou "faça", "bora", "pode").
   - Se ele pedir para **ver antes** ("me mostre uns PNGs"), gere imagens da tela real com a mudança desenhada por cima, usando folha ou dados fictícios.
1. **Só um assistente por vez** (Claude ou ChatGPT/Codex).
   - Puxe a `main` atualizada e confira se há PR aberto de outro assistente. Não mexa nos mesmos arquivos.
   - Branches: Claude usa `claude/...` e o Codex usa `codex/...`.
   - Se houver conflito, atualize a branch a partir da `main` e rode os testes de novo. Nunca force.
2. **Fluxo:** branch nova a partir da `main` → commit → PR → testes passando (local e GitHub Actions) → **o próprio assistente faz o merge** (autorizado em 13/11/2026) → confere que está no ar → conta ao Marinho, passo a passo.
3. **Mudou algo em `atlas/`:** rode `python3 _cloudflare/atlas-api/nova-versao.py AAAAMMDDx` (nova letra a cada entrega no dia). As páginas abertas se recarregam sozinhas.
4. **Mudou o banco:**
   - crie `migrations/00NN_*.sql`; a última é a **0016**, então a próxima é a 0017;
   - acrescente o mesmo bloco no fim de `schema.sql` (`-- ---------- vN ----------`);
   - suba `meta.schema_versao`;
   - atualize as verificações "Schema N" em `teste-adm`, `teste-login`, `teste-selecoes`, `teste-redacao-cadastros` e `teste-redacao-lotes`;
   - crie um teste que aplique a migração sobre o schema anterior (ex.: `teste-redacao-correcao`, migração 0016).

   **Aplicação:** o SQL entra sozinho no merge. O comando de implantação na Cloudflare é `npx wrangler d1 migrations apply atlas-teste --remote && npx wrangler deploy`. Se a migração falhar, nada é publicado.

   **Cuidados:**
   - nunca edite uma migração já mergeada;
   - prefira acrescentar coluna ou tabela.

   **Antes de juntar:** antes do merge de qualquer migração que altere ou apague tabela, peça ao Marinho para fazer uma cópia: área do ADM → **Cópias de segurança** → **"Fazer cópia agora"**. Junte só depois de **"cópia feita"** (ou de um print mostrando a "Última cópia" com o horário daquele momento).
5. **Depois do merge:**
   - confira a versão em `https://idealolimpico.com.br/atlas/versao.json`;
   - confira o schema em `/api/saude` (com o cabeçalho `Origin: https://idealolimpico.com.br`).
6. **Este arquivo (`CONTINUIDADE.md`) só é atualizado quando o Marinho pedir** (regra de 15/11/2026: atualizar a cada entrega gastava muito).

## 3. Testes

`_cloudflare/atlas-api/testes/`, com **26 suítes**:
- **Como funcionam:** SQLite real (`node:sqlite`) no lugar do D1. R2 falso que recusa fluxo sem tamanho como a Cloudflare (`r2-cloudflare.mjs`, `r2Rigoroso`). Playwright com Chromium nas telas. Nenhum e-mail real sai.
- **Folha de redação:** a folha de teste é **fictícia**, desenhada por `folha-ficticia.mjs` (`FOLHA_JS`, `pdfDeJpegs`).
- **Falhas:** quando uma suíte falha, `rodar.sh` mostra 60 linhas do erro. O GitHub Actions roda tudo em Linux em cada PR.

```
cd _cloudflare/atlas-api/testes && ./rodar.sh            # todas
./rodar.sh selecoes redacao-correcao                     # só algumas
```

**Ambiente:**
- Node 22 ou mais novo.
- Playwright **fora do repositório** (`npm install --prefix /tmp/pw playwright`; `export NODE_PATH=/tmp/pw/node_modules`).
- `preparar.sh` baixa KaTeX, ExcelJS e pdf.js para `/tmp/atlas-testes`.

**Datas:**
- as regras de férias usam a data fixa 13/11/2026 (`ATLAS_HOJE_TESTE`);
- relatórios, seleções e cópias usam o ano e o mês atuais (constante `ANO`).

## 4. Regras do Marinho (valem sempre)

- **Acesso:**
  - só e-mail `@grupoideal.com.br`, sem exceção;
  - o ADM entra com Google (`ADMIN_EMAIL`);
  - os demais entram com código de 6 dígitos;
  - o **digitalizador entra pelo cartão "Redação" → "Entrar na Redação"**.
- **Telas:**
  - sem `confirm()`, `alert()` nem `prompt()`;
  - **botões não podem mudar de lugar** quando se clica (larguras fixas, linha própria);
  - todas as páginas usam **até 1.920 px de largura**, com o topo alinhado ao conteúdo;
  - a prioridade é o **PC**; no celular, só não pode quebrar;
  - manter as cores do ATLAS: vinho no BQI e no ADM, azul-marinho na Redação.
- **Excel:** números centralizados; arquivos revisados mantêm o mesmo nome.
- **O banco está em TESTE.** Só zerar quando o Marinho pedir, com cópia antes, mantendo usuários, `meta`, `d1_migrations` e `backups/`.
- **BQI:**
  - o Supervisor edita texto, tags, assunto, subtema e Bloom;
  - a dificuldade é da escola (só se preenche quando vazia);
  - só o ADM desfaz descarte (30 dias), corrige questão **aprovada** (o servidor recusa as outras situações) e faz consertos.
- **Férias:**
  - professor, supervisor e classificador: julho e de 15/12 a 31/01;
  - digitador e digitalizador: só julho;
  - ADM: entra sempre.
- **Redação:**
  - o **EF1 está fora** (decisão de 15/11);
  - segmentos: EF2 e EM;
  - unidades: BC (Batista Campos), AM (Augusto Montenegro) e CN (Cidade Nova).

## 5. Funcionalidades prontas

### BQI (questões)
- **Professor:**
  - questão única ou grupo/testlet;
  - editor com imagens (R2) e LaTeX;
  - vários textos de apoio, fonte por alternativa e formato na prova;
  - colar alternativas;
  - aviso de repetida;
  - Meu resumo;
  - cartão "Força-tarefa" (classificador → `classificar.html`).
- **Supervisor:**
  - fila com os selos "possível repetida", "CLASSIFICAR" e "pronta para aprovar";
  - decisões, edição, conserto e "Devolver ao ADM".
- **Seleções para provas (`supervisor-selecoes.html`, PR #111), em três colunas com a questão exatamente no centro da tela.** Na edição, o menu lateral some e aparece "← Voltar às seleções".
  - **Centro:**
    - ⏮ ← "Questão N de M" → ⏭;
    - teclado: ← → e **A** (adiciona ou remove);
    - "+ Adicionar questão" (vira "Remover da prova"; no grupo, "Adicionar o grupo (N questões)");
    - a questão inteira (`/api/itens/:codigo`) e, embaixo, "Resposta e resolução".
  - **Esquerda (a prova):**
    - série, tipo e título;
    - total, **Ver escolhidas** (janela com ↑ ↓ e Retirar) e **Finalizar prova** (envia ao ADM);
    - termômetro de dificuldade: Fácil = 1, Média = 2, Difícil = 3, pela média;
    - barras do gabarito A–E (aviso se uma letra tiver 40% ou mais, com 5 ou mais questões);
    - assuntos cobertos e níveis de Bloom;
    - "Excluir esta seleção".
  - **Direita:**
    - filtros (busca, assunto, dificuldade, origem, Bloom);
    - dados da questão: código, autor, classificação, tags clicáveis, histórico de uso e espaço reservado para o "% de acerto dos alunos".
- **ADM → Questões (`admin-questoes.html`, PR #112):** duas abas.
  - **Navegar**, com três colunas e a questão no centro. O menu do ADM vira uma faixa no topo.
    - **Direita, filtros:** disciplina, professor, situação (começa em Aprovadas; tem Em análise, Aguardando ajuste, Descartadas e Todas), etapa, assunto, dificuldade, origem, Bloom e busca. Código completo na busca acha a questão em qualquer situação.
    - **Esquerda:** dados da questão, uso nas provas, versões, histórico e consertos.
    - **Centro:** setas e teclado; botão **Editar questão** (só aprovadas; vira "Fazer o conserto" quando há pedido); a questão vira o formulário de correção já existente.
    - **Rota:** `GET /api/adm/banco` (só o ADM) traz até 2.000 questões, com `usos`, `disciplinas`, `professores` e `assuntos`.
  - **Pendências:** sem disciplina, consertos e imagens antigas, com a contagem na aba.
- **ADM (outras páginas):**
  - Enviar questões ("Acervo Ideal", código provisório X);
  - Relatório de produção (+ Excel);
  - Seleções recebidas;
  - Questões retiradas (`admin.html?secao=retiradas`);
  - Cópias de segurança (`admin.html?secao=copias`).
- **Menu do ADM**, igual em todas as `admin*.html`: Cadastros e funções, Alunos, Redação, Questões, Enviar questões, Relatório de produção, Seleções recebidas, Questões retiradas, Cópias de segurança.

### Cadastros e funções (`admin.html`, schema v15, PR #107)
- **Cadastro único de pessoas** (`pessoas.js`):
  - `GET/POST /api/adm/pessoas`, `PUT /api/adm/pessoas/:id`;
  - uma pessoa pode acumular funções: **Banco de questões** (professor da disciplina, que pode ser supervisor ou classificador, ou digitador), **Professor de redação** (turmas), **Digitalizador** (unidades) e **Coordenador** (unidade/segmento/série; por enquanto só vai receber o Excel das notas).
- **Lista:**
  - busca por nome (ignora acentos e filtra enquanto digita);
  - filtros por função e disciplina;
  - selos de cada função.
- **Banco:** `redacao_equipe` ganhou os campos `professor` e `digitalizador` (0/1); há a tabela `coordenadores`. Quem sai do banco ou muda de disciplina deixa de ser supervisor.

### Alunos (`alunos-admin.html`)
- Importação da planilha `NOME COMPLETO, RA, FILIAL, SÉRIE, CODTURMA, SEGMENTO`, com prévia. Linhas do EF1 são ignoradas (`ignorados_ef1`).
- Consulta em cascata Unidade → Segmento → Série → Turma (`?turma=ID` já preenche).

### Redação
1. **ADM → Redação (`redacao-admin.html`)**, em abas:
   - **Lotes** (link para `redacao-lotes-admin.html`);
   - **Turmas**: filtros por unidade e segmento, lembrados no navegador;
   - **Equipe**: "Mapa da equipe" por unidade, com digitalizadores, coordenadores por série e professor por turma (mostra só o código da turma). Para editar, vai a "Cadastros e funções".
2. **Envio (digitalizador, `redacao.html`):**
   - escolhe bimestre → unidade → segmento → série → turma;
   - o navegador lê o RA de cada folha (Code 128) e mostra um relatório **antes** do envio;
   - a conferência é feita por `POST /api/redacao/lotes/conferir`;
   - **bloqueia** se mais da metade das folhas for de outra turma ou unidade;
   - o upload usa `FixedLengthStream` (o R2 exige tamanho conhecido); limite de 50 MB; um lote ativo por ano/bimestre/turma; o digitalizador pode cancelar em até 2 h;
   - depois do upload, envia o índice das páginas.
3. **Alinhamento (`atlas/atlas-alinhamento.js`):**
   - acha os 4 marcadores em "L" (canal vermelho, abertura 3×3 contra traços finos);
   - ajusta giro, escala e deslocamento sem deformar;
   - detecta folha de cabeça para baixo pela tinta do cabeçalho;
   - tem decodificador próprio de Code 128 para o RA;
   - usa pdf.js 4.10.38 (jsDelivr), conferido por SHA-384 antes de carregar.
   - **Validado com PDF real escaneado da turma ITAIME:** 168/168 RAs certos, todos da turma da planilha. O PDF real não está no repositório.
4. **Índice por página (schema v12, `redacao_paginas`):** o servidor decide a situação de cada página: aluno, avulsa, dúvida ou descartada.
   - **"Folhas e dúvidas" (ADM):** atribuir, descartar ou devolver; "Ver folha"; "Refazer leitura" (bloqueado quando já há correção); botão "Corrigir" nas páginas identificadas; condenadas aparecem primeiro.
5. **Correção (professora, `redacao-corrigir.html?lote=ID`, schema v13 + v16):**
   - **Rotas** (`redacao-correcao.js`):
     - `GET /api/redacao/correcao/turmas`;
     - `GET …/lotes/:id`;
     - `GET …/lotes/:id/pdf`;
     - `POST …/lotes/:id/paginas/:n`.
   - **Folha:**
     - aparece **já alinhada**, com Página inteira, zoom e ajuste −0,25°/+0,25°/Auto;
     - **marca-texto amarelo** em faixas retas (Marca-texto, Borracha, Desfazer), sem comentário em cada destaque.
   - **Notas:**
     - **por botões** (0/40/80/120/160/200; a C2 não tem o 0): clicar marca, clicar de novo desmarca, clicar em outro troca;
     - total recalculado no servidor (`conferirNota`);
     - zerar a redação inteira (11 motivos);
     - C5 = 0 exige motivo.
   - **Outros:** observação opcional; condenar página (motivos; ela vai ao ADM); cronômetro sem pausa (guarda o tempo da 1ª correção); lista do lote; revisão.
   - **Destaques:**
     - ficam em `redacao_correcoes.marcacoes`, como JSON `[{x,y,w,h}]` em frações da folha alinhada;
     - revisão sem o campo mantém os destaques; lista vazia apaga;
     - **o PDF original nunca é alterado**.
   - **Minhas turmas (`redacao.html`):**
     - a professora vê os lotes com progresso e Corrigir/Continuar/Revisar;
     - quem tem as duas funções vê as duas áreas (`funcoes`);
     - botão "← Voltar ao início".
   - **Teste real:** o Marinho corrigiu a turma ITAIME inteira em produção; as 8 páginas foram identificadas certas.
6. **Backup diário:** inclui `redacao_paginas`, `redacao_correcoes` e `coordenadores`. As cópias guardam os metadados, não os PDFs.

## 6. Próximos passos (confirmar a ordem com o Marinho antes)

1. **Espelho do aluno + integração com o portal de inscrições:** o Marinho disse em 15/11 que esta será a **próxima implementação**.
   - **Formato decidido:** cada página vira um **PNG** já alinhado, com os destaques amarelos, as notas C1–C5 e as observações. O PDF original fica intacto.
   - Mockup aprovado: espelho com a folha à esquerda e, à direita, a nota final, as competências com barras e as observações.
   - Decisões sobre a integração: §7.
2. **Mapa da turma + "Concluir turma" + Excel por e-mail** (combinado, ainda não feito):
   - **Mapa da turma:** aba dentro da tela de correção e botão em Minhas turmas, com linha de médias, cores nas notas e filtro de situação. **Sem mapa no ADM.**
   - **"Editar"** no mapa volta para a redação.
   - **"Concluir turma"** envia o Excel (formato da planilha de alunos + notas) aos coordenadores (por unidade/série; cada um só os seus alunos), ao ADM e à professora.
   - Se a nota mudar depois, o Excel corrigido é reenviado.
3. **Bloco B da correção:**
   - avulsa: a professora escolhe o aluno entre os não identificados;
   - "não fez a prova";
   - condenar o lote inteiro;
   - relatório de tempo no ADM (por professor: turmas, tempo total e média).
4. **BQI:**
   - piloto de Matemática (ainda não começou);
   - depois, zerar o banco quando o Marinho pedir.
   - **Ideias:** importar provas do Word; `api.idealolimpico.com.br`; organização GitHub; BQI etapa 2 (resultados por planilha, taxa de acerto, que vai preencher o "% de acerto" já reservado nas telas).
5. **Possível pedido futuro:** o ADM editar questões em qualquer situação. Hoje o servidor só deixa editar as aprovadas; apresente as opções se ele pedir.

## 7. Integração com o portal de inscrições — decisões (15/11/2026)

- O aluno entra no portal (`inscricoes/`) com **matrícula de 5 dígitos (= RA do ATLAS) + data de nascimento**. O servidor `ideal-olimpico-producao` repassa ao Google Apps Script (código fora do repositório).
- Decidido:
  - integrar só **depois que houver notas**;
  - o **servidor do portal** confirma a sessão do aluno e pede ao ATLAS as notas daquela matrícula, com um segredo entre servidores guardado só na Cloudflare (o ATLAS **nunca** aceita uma matrícula vinda do navegador);
  - a planilha importada no ATLAS é a lista oficial;
  - "NÃO MEXER no portal" fica liberado **só para o "MEU DESEMPENHO"**, com autorização e teste na homologação (`teste-inscricoes/`).
- A decidir na época: reforço do login do portal (matrícula + nascimento é fraco para notas de menores); LGPD e retenção das notas e dos espelhos entre anos.
