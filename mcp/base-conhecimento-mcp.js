#!/usr/bin/env node
/* ============================================================
   MCP da Base de conhecimento pessoal (stdio, sem dependência).
   Deixa o Claude buscar, perguntar, ler, registrar e corrigir
   conhecimentos pela API do app. Não existe ferramenta de apagar.

   Configuração (nesta ordem): variáveis BASE_URL e BASE_TOKEN, ou
   o arquivo ~/.config/base-conhecimento/.env com essas duas linhas.
   Registrar no Claude Code:
     claude mcp add base-conhecimento -s user -- node <caminho>/mcp/base-conhecimento-mcp.js
   ============================================================ */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const cfg = { BASE_URL: process.env.BASE_URL, BASE_TOKEN: process.env.BASE_TOKEN };
try {
  for (const linha of readFileSync(`${homedir()}/.config/base-conhecimento/.env`, 'utf8').split('\n')) {
    const m = linha.match(/^\s*(BASE_URL|BASE_TOKEN)\s*=\s*(.+?)\s*$/);
    if (m && !cfg[m[1]]) cfg[m[1]] = m[2];
  }
} catch {}
const URL_BASE = (cfg.BASE_URL || 'https://conhecimento.samuelfreire.com.br').replace(/\/$/, '');

async function api(caminho, metodo = 'GET', corpo) {
  if (!cfg.BASE_TOKEN) throw new Error('Falta BASE_TOKEN em ~/.config/base-conhecimento/.env');
  const r = await fetch(URL_BASE + caminho, {
    method: metodo,
    headers: { 'x-token': cfg.BASE_TOKEN, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || `A base respondeu ${r.status}.`);
  return d;
}

const texto = (x) => `#${x.id} · ${x.c.join(' > ')} · prioridade ${x.p} · ${x.f || 'sem fonte'}${x.url ? ' (' + x.url + ')' : ''} · ${x.d}\n${x.t}` +
  ((x.corpo || []).length ? '\n' + x.corpo.map((b) => (typeof b === 'string' ? b : b.sec ? `\n${b.sec}:` : b.cit ? `Trecho: ${b.cit}` : b.nota ? `Anotação: ${b.nota}` : (b.lista || []).map((i) => `- ${i}`).join('\n'))).join('\n') : '');

const FERRAMENTAS = [
  {
    name: 'buscar_conhecimento',
    description: 'Busca na base de conhecimento pessoal do Samuel (livros, vídeos, eventos, conversas, ideias). Use antes de responder qualquer pergunta sobre o que ele já aprendeu.',
    inputSchema: { type: 'object', properties: { consulta: { type: 'string', description: 'Palavras-chave ou tema' }, limite: { type: 'number', description: 'Máximo de resultados (padrão 15)' } }, required: ['consulta'] },
    rodar: async ({ consulta, limite }) => {
      const d = await api(`/api/buscar?q=${encodeURIComponent(consulta)}&limite=${limite || 15}`);
      return d.itens.length ? d.itens.map(texto).join('\n\n---\n\n') : 'Nada encontrado na base para essa consulta.';
    },
  },
  {
    name: 'perguntar_base',
    description: 'Faz uma pergunta em linguagem natural ao assistente da base; ele responde só com o que está registrado e cita os ids [#id].',
    inputSchema: { type: 'object', properties: { pergunta: { type: 'string' } }, required: ['pergunta'] },
    rodar: async ({ pergunta }) => (await api('/api/assistente', 'POST', { pergunta })).resposta,
  },
  {
    name: 'ver_conhecimento',
    description: 'Mostra um conhecimento completo pelo id, com os ligados.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    rodar: async ({ id }) => {
      const d = await api(`/api/conhecimentos/${id}`);
      return texto(d.item) + (d.ligados.length ? '\n\nLigado a:\n' + d.ligados.filter(Boolean).map((x) => `#${x.id} ${x.t}`).join('\n') : '');
    },
  },
  {
    name: 'listar_temas',
    description: 'Lista a árvore de temas e galhos da base, com quantos conhecimentos cada um tem.',
    inputSchema: { type: 'object', properties: {} },
    rodar: async () => {
      const d = await api('/api/arvore');
      return `${d.total} conhecimentos.\n` + Object.entries(d.caminhos).map(([k, n]) => `${k}: ${n}`).join('\n');
    },
  },
  {
    name: 'registrar_conhecimento',
    description: 'Registra um conhecimento novo na base. A IA da base escolhe o tema e o galho, liga com o que já existe e agenda a revisão. Mande o conteúdo completo e fiel; não resuma por conta própria.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'O conteúdo completo do insight' },
        fonte: { type: 'string', description: 'Livro e autor, vídeo, evento ou pessoa (opcional)' },
        origem: { type: 'string', enum: ['livro', 'video', 'evento', 'conversa', 'nota'], description: 'nota = ideia do próprio Samuel' },
        prioridade: { type: 'number', description: '1 a 5; omita para a IA sugerir' },
        caminho: { type: 'array', items: { type: 'string' }, description: '[tema, galho, sub-galho opcional]; omita para a IA escolher. Use listar_temas antes para reaproveitar nomes.' },
        url: { type: 'string', description: 'Link da fonte (vídeo, artigo), se houver' },
      },
      required: ['texto'],
    },
    rodar: async ({ texto: t, fonte, origem, prioridade, caminho, url }) => {
      const d = await api('/api/registrar', 'POST', { texto: t, fonte, origem: origem || 'nota', prioridade, caminho, url, tipo: 'mcp' });
      return `Registrado como #${d.item.id} em ${d.item.c.join(' > ')}${d.galhoNovo ? ' (galho novo)' : ''}, prioridade ${d.item.p}.` +
        (d.ligados.length ? `\nLigado a: ${d.ligados.filter(Boolean).map((x) => `#${x.id}`).join(', ')}` : '') + (d.aviso ? `\nAviso: ${d.aviso}` : '');
    },
  },
  {
    name: 'atualizar_conhecimento',
    description: 'Corrige um conhecimento existente: título, fonte, prioridade ou caminho [tema, galho, sub-galho]. Não apaga nada.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, titulo: { type: 'string' }, fonte: { type: 'string' }, url: { type: 'string', description: 'link da fonte' }, prioridade: { type: 'number' }, caminho: { type: 'array', items: { type: 'string' } } },
      required: ['id'],
    },
    rodar: async ({ id, titulo, fonte, url, prioridade, caminho }) => {
      const d = await api(`/api/conhecimentos/${id}`, 'PATCH', { t: titulo, f: fonte, url, p: prioridade, c: caminho });
      return 'Atualizado:\n' + texto(d.item);
    },
  },
];

/* ---------- protocolo MCP (JSON-RPC por linha) ---------- */
const enviar = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
createInterface({ input: process.stdin }).on('line', async (linha) => {
  let m;
  try { m = JSON.parse(linha); } catch { return; }
  const responder = (result) => m.id !== undefined && enviar({ jsonrpc: '2.0', id: m.id, result });
  try {
    if (m.method === 'initialize') return responder({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'base-conhecimento', version: '1.0.0' } });
    if (m.method === 'tools/list') return responder({ tools: FERRAMENTAS.map(({ rodar, ...f }) => f) });
    if (m.method === 'tools/call') {
      const f = FERRAMENTAS.find((x) => x.name === m.params?.name);
      if (!f) return responder({ content: [{ type: 'text', text: 'Ferramenta desconhecida.' }], isError: true });
      try { return responder({ content: [{ type: 'text', text: await f.rodar(m.params.arguments || {}) }] }); }
      catch (e) { return responder({ content: [{ type: 'text', text: 'Erro: ' + e.message }], isError: true }); }
    }
    if (m.method === 'ping') return responder({});
    if (m.id !== undefined) enviar({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Método não suportado' } });
  } catch (e) {
    if (m.id !== undefined) enviar({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: e.message } });
  }
});
