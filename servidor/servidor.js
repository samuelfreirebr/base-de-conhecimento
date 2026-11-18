/* ============================================================
   Base de conhecimento pessoal — servidor.
   Node puro, sem dependência. Serve o app (site/) e a API (/api).
   Variáveis: SENHA_APP (obrigatória), TOKEN_API (MCP e outros
   sistemas), OPENROUTER_API_KEY, OPENROUTER_MODELO, PASTA_DADOS,
   PORTA.
   ============================================================ */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import * as seg from './seguranca.js';
import { lerCorpo } from './multipart.js';
import * as base from './dados.js';
import * as ia from './ia.js';
import { legendaDoYoutube, trechosDeTexto, textoDoDocx } from './fontes-externas.js';

const PORTA = Number(process.env.PORTA || 3000);
const SITE = process.env.PASTA_SITE || new URL('../site', import.meta.url).pathname;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const PUBLICOS = /^\/(entrar\.html|manifest\.webmanifest|sw\.js|icone[\w-]*\.(png|svg)|fontes\/[\w.-]+)$/;

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function lerJson(req, limite = 2e6) {
  const b = await lerCorpo(req, limite);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw erro('Dados inválidos.'); }
}
async function servirArquivo(res, caminho) {
  const alvo = normalize(join(SITE, caminho === '/' ? 'index.html' : caminho));
  if (!alvo.startsWith(SITE)) return json(res, 403, { erro: 'Proibido.' });
  try {
    const dado = await readFile(alvo);
    const ext = extname(alvo);
    res.writeHead(200, { 'content-type': TIPOS[ext] || 'application/octet-stream', 'cache-control': ext === '.woff2' || ext === '.png' ? 'public, max-age=604800' : 'no-cache' });
    res.end(dado);
  } catch { json(res, 404, { erro: 'Não encontrado.' }); }
}

/* ---------- registrar: a IA organiza e a base guarda ---------- */
async function registrar(d) {
  const texto = String(d.texto || '').trim();
  if (!texto) throw erro('Mande o conteúdo antes de registrar.');
  const arvoreAntes = base.caminhos();
  const candidatos = base.candidatos(texto);
  let org = null, aviso = '';
  if (ia.temIA()) {
    try { org = await ia.organizar({ texto, origem: d.origem, fonte: d.fonte, arvore: arvoreAntes, candidatos }); }
    catch (e) { console.error('organizar', e.message); aviso = 'A IA não respondeu agora; guardei em "Sem tema" para organizar depois.'; }
  } else aviso = 'Sem chave da IA configurada; guardei em "Sem tema".';
  if (!org || !org.titulo || org.caminho.length < 2) {
    const frases = texto.split(/(?<=[.!?])\s+/);
    org = { titulo: frases[0].slice(0, 180), corpo: frases.length > 1 ? [texto] : [], caminho: ['Sem tema', 'Para organizar'], prioridade: 3, motivo: '', ligacoes: [], fonte: d.fonte || '' };
  }
  const escolhida = Number(d.prioridade);
  const item = base.adicionar({
    t: org.titulo, corpo: org.corpo, c: org.caminho, f: org.fonte || d.fonte || '',
    o: ['livro', 'video', 'evento', 'conversa', 'nota'].includes(d.origem) ? d.origem : 'nota',
    tipo: d.tipo || 'texto', p: escolhida >= 1 && escolhida <= 5 ? escolhida : org.prioridade, pIA: org.prioridade,
    extras: d.url ? { url: String(d.url) } : undefined,
  });
  org.ligacoes.forEach((id) => base.ligar(item.id, id));
  await base.salvar();
  const galhoNovo = !arvoreAntes[item.c.slice(0, 2).join(' > ')];
  atualizarResumo(item.c.slice(0, 2));
  return { item, galhoNovo, motivo: org.motivo, ligados: base.ligacoesDe(item.id).map(base.porId), aviso };
}

/* resumo do galho em segundo plano: quem registrou não espera por ele */
function atualizarResumo(cam) {
  if (!ia.temIA()) return;
  const chave = cam.join('>');
  const itens = base.tudo().itens.filter((x) => cam.every((p, i) => x.c[i] === p)).sort((a, b) => b.p - a.p).slice(0, 25);
  if (itens.length < 2) return;
  ia.resumirGalho(cam.join(' > '), itens).then((t) => { base.tudo().resumos[chave] = t; base.salvar(); }).catch(() => {});
}

/* ---------- rotas da API ---------- */
async function api(req, res, url) {
  const rota = `${req.method} ${url.pathname}`;
  const idRota = url.pathname.match(/^\/api\/conhecimentos\/(\d+)$/);

  if (rota === 'GET /api/base') {
    const b = base.tudo();
    return json(res, 200, { itens: b.itens, ligacoes: b.ligacoes, resumos: b.resumos, hoje: base.hoje(), ia: ia.temIA() });
  }
  if (rota === 'POST /api/registrar') return json(res, 200, await registrar(await lerJson(req)));
  if (rota === 'POST /api/revisar') {
    const d = await lerJson(req);
    const r = base.marcarRevisao(Number(d.id), d.lembrou);
    if (!r) throw erro('Conhecimento não encontrado.', 404);
    await base.salvar();
    return json(res, 200, { ...r, hoje: base.hoje() });
  }
  if (rota === 'POST /api/transcrever') {
    if (!ia.temIA()) throw erro('A IA não está configurada no servidor.', 503);
    const wav = await lerCorpo(req, 15e6);
    const texto = await ia.transcrever(wav);
    if (!texto) throw erro('Não ouvi nada no áudio. Tente gravar de novo.', 422);
    return json(res, 200, { texto });
  }
  if (rota === 'POST /api/foto') {
    if (!ia.temIA()) throw erro('A IA não está configurada no servidor.', 503);
    const img = await lerCorpo(req, 12e6);
    const tipo = req.headers['content-type'] || 'image/jpeg';
    const r = await ia.lerFoto(`data:${tipo};base64,${img.toString('base64')}`, url.searchParams.get('marcado') === '1');
    return json(res, 200, r);
  }
  if (rota === 'POST /api/arquivo') {
    const nome = decodeURIComponent(String(req.headers['x-nome'] || 'arquivo'));
    const bytes = await lerCorpo(req, 25e6);
    const ext = (nome.split('.').pop() || '').toLowerCase();
    if (['txt', 'md', 'csv'].includes(ext)) return json(res, 200, { titulo: nome, trechos: trechosDeTexto(bytes.toString('utf8')) });
    if (ext === 'docx') return json(res, 200, { titulo: nome, trechos: trechosDeTexto(textoDoDocx(bytes)) });
    if (!ia.temIA()) throw erro('Para ler PDF e imagem a IA precisa estar configurada.', 503);
    if (ext === 'pdf') return json(res, 200, await ia.lerPdf(bytes, nome));
    if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)) {
      const r = await ia.lerFoto(`data:${req.headers['content-type'] || 'image/jpeg'};base64,${bytes.toString('base64')}`, false);
      return json(res, 200, { titulo: nome, trechos: r.trechos.map((t, i) => ({ h: `§ ${i + 1}`, t })) });
    }
    throw erro('Tipo de arquivo não suportado. Use PDF, Word, texto ou imagem.', 415);
  }
  if (rota === 'POST /api/youtube') {
    const link = String((await lerJson(req)).url || '');
    try { return json(res, 200, await legendaDoYoutube(link)); }
    catch (e) {
      if (e.status === 400 || !ia.temIA()) throw e;
      /* sem legenda pública: o Gemini assiste o vídeo pelo link */
      const r = await ia.videoDoYoutube(link).catch(() => null);
      if (!r || !r.trechos.length) throw erro('Não consegui puxar o texto deste vídeo. Abra no YouTube, toque em "Mostrar transcrição", copie e cole no campo Texto.', 422);
      return json(res, 200, { canal: '', minutos: 0, ...(e.info || {}), titulo: e.info?.titulo || r.titulo, idioma: 'pela IA', automatica: true, trechos: r.trechos });
    }
  }
  if (rota === 'POST /api/assistente') {
    if (!ia.temIA()) throw erro('A IA não está configurada no servidor.', 503);
    const d = await lerJson(req);
    const pergunta = String(d.pergunta || '').trim();
    if (!pergunta) throw erro('Escreva a pergunta.');
    const contexto = [...(d.historico || []).slice(-2).map((m) => m.texto), pergunta].join(' ');
    let itens = base.buscar(contexto, 14);
    if (!itens.length) itens = [...base.tudo().itens].sort((a, b) => b.p - a.p).slice(0, 14);
    return json(res, 200, await ia.responder(pergunta, d.historico, itens));
  }
  if (rota === 'GET /api/buscar') return json(res, 200, { itens: base.buscar(url.searchParams.get('q') || '', Number(url.searchParams.get('limite')) || 15) });
  if (rota === 'GET /api/arvore') return json(res, 200, { caminhos: base.caminhos(), total: base.tudo().itens.length });
  if (idRota && req.method === 'GET') {
    const x = base.porId(idRota[1]);
    if (!x) throw erro('Conhecimento não encontrado.', 404);
    return json(res, 200, { item: x, ligados: base.ligacoesDe(x.id).map(base.porId) });
  }
  if (idRota && req.method === 'PATCH') {
    const x = base.editar(idRota[1], await lerJson(req));
    if (!x) throw erro('Conhecimento não encontrado.', 404);
    await base.salvar();
    return json(res, 200, { item: x });
  }
  throw erro('Rota não encontrada.', 404);
}

/* ---------- servidor ---------- */
await base.carregar();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/estado') return json(res, 200, { ok: true });

    if (url.pathname === '/entrar' && req.method === 'POST') {
      const espera = seg.bloqueado(req);
      if (espera) { res.writeHead(303, { location: '/entrar.html?erro=bloqueado' }); return res.end(); }
      const senha = new URLSearchParams((await lerCorpo(req, 1e4)).toString()).get('senha');
      if (!seg.senhaCerta(senha)) { seg.registrarFalha(req); res.writeHead(303, { location: '/entrar.html?erro=senha' }); return res.end(); }
      seg.limparFalhas(req);
      res.writeHead(303, { location: '/', 'set-cookie': seg.cookieDeSessao(req, seg.criarSessao()) });
      return res.end();
    }
    if (url.pathname === '/sair') { res.writeHead(303, { location: '/entrar.html', 'set-cookie': seg.cookieDeSaida() }); return res.end(); }
    if (PUBLICOS.test(url.pathname)) return servirArquivo(res, url.pathname);

    if (!seg.liberado(req)) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { erro: 'Entre de novo.', entrar: true });
      res.writeHead(303, { location: '/entrar.html' });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET') return json(res, 405, { erro: 'Método não permitido.' });
    return servirArquivo(res, url.pathname === '/' ? '/' : url.pathname);
  } catch (e) {
    if (!e.status) console.error(e);
    json(res, e.grande ? 413 : e.status || 500, { erro: e.status || e.grande ? e.message : 'Algo deu errado no servidor. Tente de novo.' });
  }
}).listen(PORTA, process.env.HOSTNAME || '0.0.0.0', () => console.log(`Base de conhecimento na porta ${PORTA}`));
