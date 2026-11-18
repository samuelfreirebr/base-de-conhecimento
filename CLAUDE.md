# Base de conhecimento pessoal (app)

App do Samuel para guardar e relembrar o que aprendeu. Endereço: https://conhecimento.samuelfreire.com.br
Arquivos de projeto (protótipo, decisões, regras de produto): Drive `PROJETOS : PORTFÓLIO/CLAUDE CODE HUB/01-PROJETOS-PROPRIOS/SEGUNDO-CEREBRO/` (ler o CLAUDE.md de lá).

## Como é feito
- Node puro, sem dependência e sem build (mesmo padrão do site institucional). `servidor/` = API e login; `site/` = o app (um HTML com central de ajustes no topo).
- Dados: `/dados/base.json` no volume (local: `dados-local/`, fora do git). Cada gravação guarda a anterior em `base.anterior.json`.
- IA pelo OpenRouter (`servidor/ia.js`): organizar (tema, galho, ligações, prioridade), foto com marcação, áudio, PDF, vídeo do YouTube sem legenda, assistente.
- Revisão espaçada: `servidor/srs.js` (FSRS). Teste: `node servidor/srs.teste.js`.
- Publicação: push na main → Action → ghcr.io/samuelfreirebr/base-de-conhecimento → Portainer (`docker-stack.yml`).

## API e MCP
- Toda rota `/api/*` aceita o cabeçalho `x-token` = `TOKEN_API` (stack). Lê, cria e edita; não existe rota de apagar.
- MCP: `mcp/base-conhecimento-mcp.js`, registrado no Claude Code como `base-conhecimento`. Lê `~/.config/base-conhecimento/.env` (BASE_URL e BASE_TOKEN). Nunca imprimir a chave.

## Regras
- Sem travessão nos textos. Identidade Samuel Freire. Nunca apagar dados do volume.
