# Workers do Cloudflare (cópia de segurança)

Código dos servidores que ficam no Cloudflare (conta marinhomalcher), copiado
exatamente como está publicado em 2026-11-07.

| Pasta | Endereço | Função |
|---|---|---|
| `ideal-olimpico-producao/` | ideal-olimpico-producao.marinhomalcher.workers.dev/api | Área do aluno (oficial). Repassa os pedidos ao Apps Script de produção, com limites contra excesso de tentativas. |
| `ideal-olimpico-homologacao/` | ideal-olimpico-homologacao.marinhomalcher.workers.dev/api | Versão de testes (dados fictícios). |

Regras:

- **Nenhum segredo entra no Git.** URLs do Apps Script e senhas ficam só em
  Cloudflare > Workers > (worker) > Configurações > Variáveis e segredos.
- Ao mudar um Worker no painel do Cloudflare, atualize também o arquivo aqui
  (e vice-versa), para que Claude e ChatGPT enxerguem a versão real.
- Para publicar a partir desta pasta: `npx wrangler deploy` dentro da pasta do Worker.

## atlas-api (ATLAS — banco de questões)

`atlas-api/` é o servidor do ATLAS, ainda em **modo de teste**: só responde a
`/api/saude` e não expõe dados. Usa o banco D1 `atlas-teste`
(estrutura em `atlas-api/schema.sql`). As rotas de questões só serão abertas
depois do login com a conta Microsoft da escola.

A pasta começa com `_` para o GitHub Pages não publicá-la no site.
