# Migração do Portal de inscrições para o ATLAS — começar em dezembro/2026

Texto para abrir a conversa com o assistente quando a migração começar (decisão do Marinho em 21/11/2026).
Cole o bloco abaixo como primeira mensagem.

```
MIGRAÇÃO DO PORTAL DE INSCRIÇÕES PARA O ATLAS — começar em dezembro/2026

Contexto
- Repositório: C:\ATLAS\ATLAS (público; nada de segredo nem dado real de aluno no código).
- Leia antes de tudo: _cloudflare/atlas-api/CONTINUIDADE.md e as memórias do projeto. Fale comigo sempre em português, em respostas curtas, e só implemente depois do meu "pode fazer".
- Hoje o Portal do aluno (inscricoes/) usa como banco uma planilha do Google + Apps Script (código fora do repositório). O Worker _cloudflare/ideal-olimpico-producao repassa as chamadas do portal.js ao Apps Script. A coordenação (inscricoes/coordenador/) abre o Apps Script numa ponte em iframe e pede um segundo login Google.
- O ATLAS (Cloudflare Worker atlas-api + banco D1, telas em atlas/ e painel em adm/) já é a base do cadastro de alunos desde 21/11/2026 (PR #151): tabela alunos (schema 19, _cloudflare/atlas-api/alunos.js), tela atlas/alunos-admin.html, rotas /api/portal/aluno e /api/portal/aluno/confirmar. O Worker do portal, com o segredo PORTAL_ATLAS_SECRET, lê e grava o cadastro do aluno no ATLAS.
- O cadastro de alunos do ano novo só acontece em fevereiro/2027. Dezembro e janeiro são a janela da migração.

Objetivo
Aposentar a planilha e o Apps Script como banco do Portal. No fim: um login, um servidor (atlas-api) e um banco (D1). A coordenação vira uma aba normal do /adm/, sem segundo login.

Etapas sugeridas (confirme a ordem comigo com perguntas de marcar antes de começar; uma etapa por PR)
1. Catálogo e edições: trazer para o ATLAS as abas OLIMPIADAS, COMPETICOES, GRUPOS_PORTAL, ELEGIVEIS e CONFIGURACOES (olimpíadas, edições, fases, datas, prazo no portal, valores por grupo, quem pode se inscrever). Tela no /adm/ > Olimpíadas para cadastrar, abrir, encerrar e retirar competições. O portal passa a ler o catálogo do ATLAS.
2. Login do aluno direto no ATLAS: matrícula + código de 6 dígitos no e-mail RA@aluno.grupoideal.com.br (o ATLAS já envia esse e-mail), sessão e "acesso lembrado" de 5 dias no ATLAS. A tela "Confira seus dados" do portal grava direto no ATLAS.
3. Inscrições, pedidos e comprovantes: carrinho, pedido por competição, Pix (valores separados por competição, nunca somados), envio de comprovante, avisos ao aluno por e-mail (o ATLAS já envia como olimpiadas@grupoideal.com.br). Meu desempenho, Conquistas e Certificados já leem do ATLAS/SharePoint; conferir o que ainda passa pelo Apps Script.
4. Coordenação dentro do /adm/: conferir comprovantes, aprovar pagamento + inscrição oficial, rejeitar, CSV de inscritos, backup, solicitações cadastrais. Sem a ponte em iframe e sem segundo login.
5. Desligar o Apps Script e o Worker ideal-olimpico-producao (ou deixá-lo só como redirecionamento), apagar a planilha do fluxo, atualizar CONTINUIDADE.md.

Regras que valem sempre
- Branch claude/..., PR, todas as suítes passando (cd _cloudflare/atlas-api/testes && ./rodar.sh; no Windows: export ATLAS_TESTE_TMP=/c/tmp/atlas-testes NODE_PATH=/c/ATLAS/pw/node_modules), eu confiro, depois o merge. Mudou atlas/: python _cloudflare/atlas-api/nova-versao.py AAAAMMDDx e converter CRLF para LF.
- Mudou o banco: nova migração (a próxima é a 0020), mesmo bloco no fim de schema.sql, subir meta.schema_versao, atualizar os testes que conferem "Schema N", teste aplicando a migração sobre o schema anterior. Antes do merge de migração que altere ou apague tabela, me peça a cópia de segurança.
- Telas: sem confirm/alert/prompt, botões não mudam de lugar, até 1.920 px, prioridade no PC. Cores: vinho no BQI/ADM, azul-marinho na Redação. Excel: números centralizados, arquivos sem data no nome.
- Nenhum dado real de aluno no repositório; testes com alunos fictícios (matrícula 99999).
- A cada etapa, me apresente primeiro o desenho (telas e o que muda para o aluno e para a coordenação), com prós e contras, e espere o "pode fazer".

Comece lendo o CONTINUIDADE.md, o alunos.js, o worker do portal e o portal.js, e me traga o plano da etapa 1 com as perguntas para eu marcar.
```
