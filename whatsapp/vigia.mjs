#!/usr/bin/env node
/* ============================================================
   Vigia do WhatsApp → Base de conhecimento.
   Roda no Mac a cada minuto (LaunchAgent). Lê, só lendo, o banco
   do conector do WhatsApp pessoal (~/Apps/whatsapp-mcp) e manda
   cada mensagem nova do grupo "Base de conhecimento" para a base:
     texto  → registra (linha "fonte: ..." e "prioridade N" opcionais)
     foto   → lê só o marcado (sem marcação: a página toda) e guarda a foto leve
     áudio  → transcreve e registra
     link do YouTube → puxa a transcrição e registra
     PDF/Word/texto → lê e registra
   Nunca envia nada no WhatsApp. Configuração e estado em
   ~/.config/base-conhecimento/ (.env e whatsapp-estado.json).
   ============================================================ */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const CFG = join(homedir(), '.config/base-conhecimento');
const ESTADO = join(CFG, 'whatsapp-estado.json');
const LOG = join(homedir(), 'Library/Logs/base-conhecimento-whatsapp.log');
const BANCO = join(homedir(), 'Apps/whatsapp-mcp/whatsapp-bridge/store/messages.db');
const PONTE = 'http://127.0.0.1:8080';
const FFMPEG = join(homedir(), '.local/bin/ffmpeg');

const env = Object.fromEntries(readFileSync(join(CFG, '.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const NOME_GRUPO = env.WHATSAPP_GRUPO_NOME || 'Base de conhecimento';
const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);

async function api(caminho, op = {}) {
  const r = await fetch(env.BASE_URL + caminho, {
    method: op.method || 'POST',
    headers: { 'x-token': env.BASE_TOKEN, ...(op.json ? { 'content-type': 'application/json' } : {}), ...(op.headers || {}) },
    body: op.json ? JSON.stringify(op.json) : op.body,
    signal: AbortSignal.timeout(420000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || `base respondeu ${r.status}`);
  return d;
}

/* "fonte: Hábitos Atômicos" e "prioridade 5" (ou "p5") em qualquer linha viram campos; o resto é conteúdo */
function lerDiretivas(texto) {
  let fonte = '', prioridade = 0, origem = '', tudo = false;
  const resto = String(texto || '').split('\n').filter((linha) => {
    const l = linha.trim();
    let m;
    if ((m = l.match(/^fonte\s*[:\-]\s*(.+)$/i))) { fonte = m[1].trim(); return false; }
    if ((m = l.match(/^(?:prioridade|p)\s*[:\-]?\s*([1-5])$/i))) { prioridade = Number(m[1]); return false; }
    if ((m = l.match(/^(livro|v[ií]deo|evento|conversa|ideia)\s*[:\-]\s*(.+)$/i))) {
      origem = { livro: 'livro', video: 'video', 'vídeo': 'video', evento: 'evento', conversa: 'conversa', ideia: 'nota' }[m[1].toLowerCase()];
      fonte = m[2].trim(); return false;
    }
    if (/^(tudo|p[aá]gina toda|sem marca[cç][aã]o)$/i.test(l)) { tudo = true; return false; }
    return true;
  }).join('\n').trim();
  return { resto, fonte, prioridade, origem, tudo };
}

async function baixar(msg) {
  const r = await fetch(PONTE + '/api/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message_id: msg.id, chat_jid: msg.chat_jid }), signal: AbortSignal.timeout(120000) });
  const d = await r.json().catch(() => ({}));
  if (!d.success || !d.path) throw new Error(d.message || 'não consegui baixar a mídia');
  /* copia já com nome único (o conector reaproveita nomes de áudio) */
  const ext = (d.path.split('.').pop() || 'bin').toLowerCase();
  const destino = join(tmpdir(), `base-wa-${msg.id}.${ext}`);
  copyFileSync(d.path, destino);
  return { caminho: destino, ext, nome: d.filename || `arquivo.${ext}` };
}

async function processar(msg) {
  const tipo = msg.media_type || '';
  const dir = lerDiretivas(msg.content);
  const registrar = (extra) => api('/api/registrar', { json: { fonte: dir.fonte, prioridade: dir.prioridade, origem: dir.origem || extra.origem || 'nota', ...extra } });

  if (!tipo) {
    if (!dir.resto) return 'mensagem sem conteúdo (só diretivas)';
    const yt = dir.resto.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/\S+|youtu\.be\/\S+)/i);
    if (yt) {
      const v = await api('/api/youtube', { json: { url: yt[0] } });
      const comentario = dir.resto.replace(yt[0], '').trim();
      const texto = (comentario ? comentario + '\n\n' : '') + v.trechos.map((t) => t.t).join('\n\n');
      const r = await registrar({ texto, tipo: 'youtube', origem: 'video', url: yt[0], fonte: dir.fonte || `${v.titulo}${v.canal ? ', ' + v.canal : ''}` });
      return `YouTube #${r.item.id} ${r.item.c.join(' > ')}`;
    }
    const r = await registrar({ texto: dir.resto, tipo: 'whatsapp' });
    return `texto #${r.item.id} ${r.item.c.join(' > ')}`;
  }

  if (tipo === 'image') {
    const f = await baixar(msg);
    try {
      const img = readFileSync(f.caminho);
      let d = await api(`/api/foto?marcado=${dir.tudo ? 0 : 1}`, { body: img, headers: { 'content-type': 'image/jpeg' } });
      if (!d.trechos.length && !dir.tudo) d = await api('/api/foto?marcado=0', { body: img, headers: { 'content-type': 'image/jpeg' } });
      if (!d.trechos.length) return 'foto sem texto legível, ignorada';
      let imagem;
      if (img.length < 3e6 && img[0] === 0xff && img[1] === 0xd8) imagem = (await api('/api/imagem', { body: img, headers: { 'content-type': 'image/jpeg' } })).imagem;
      const texto = (dir.resto ? dir.resto + '\n\n' : '') + d.trechos.join('\n\n');
      const r = await registrar({ texto, tipo: 'foto', origem: 'livro', imagem, fonte: dir.fonte || d.fonte });
      return `foto #${r.item.id} ${r.item.c.join(' > ')} (${d.marcacoes || 'página toda'})`;
    } finally { rmSync(f.caminho, { force: true }); }
  }

  if (tipo === 'audio') {
    const f = await baixar(msg);
    const wav = f.caminho + '.wav';
    try {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', f.caminho, '-ac', '1', '-ar', '16000', wav]);
      const t = await api('/api/transcrever', { body: readFileSync(wav), headers: { 'content-type': 'audio/wav' } });
      const r = await registrar({ texto: t.texto, tipo: 'audio' });
      return `áudio #${r.item.id} ${r.item.c.join(' > ')}`;
    } finally { rmSync(f.caminho, { force: true }); rmSync(wav, { force: true }); }
  }

  if (tipo === 'document') {
    const f = await baixar(msg);
    try {
      const d = await api('/api/arquivo', { body: readFileSync(f.caminho), headers: { 'x-nome': encodeURIComponent(f.nome) } });
      const texto = ((dir.resto ? dir.resto + '\n\n' : '') + d.trechos.map((t) => t.t).join('\n\n')).slice(0, 12000);
      const r = await registrar({ texto, tipo: 'arquivo', fonte: dir.fonte || (d.titulo || f.nome).replace(/\.\w+$/, '') });
      return `arquivo #${r.item.id} ${r.item.c.join(' > ')}`;
    } finally { rmSync(f.caminho, { force: true }); }
  }
  return `tipo ${tipo} não suportado, ignorado`;
}

/* ---------- uma rodada ---------- */
mkdirSync(CFG, { recursive: true });
let estado = {};
try { estado = JSON.parse(readFileSync(ESTADO, 'utf8')); } catch {}
const db = new DatabaseSync(BANCO, { readOnly: true });
const grupo = env.WHATSAPP_GRUPO_JID
  ? { jid: env.WHATSAPP_GRUPO_JID }
  : db.prepare("SELECT jid FROM chats WHERE jid LIKE '%@g.us' AND lower(name) = lower(?) ORDER BY last_message_time DESC LIMIT 1").get(NOME_GRUPO);
if (!grupo) { if (!estado.avisouSemGrupo) { log(`esperando o grupo "${NOME_GRUPO}" aparecer no WhatsApp`); writeFileSync(ESTADO, JSON.stringify({ ...estado, avisouSemGrupo: true })); } process.exit(0); }

/* primeira vez: começa de agora (não importa o histórico do grupo) */
if (!estado.desde) {
  const ultima = db.prepare('SELECT max(timestamp) t FROM messages WHERE chat_jid = ?').get(grupo.jid);
  estado = { desde: ultima?.t || '0', feitos: [], falhas: {} };
  writeFileSync(ESTADO, JSON.stringify(estado));
  log(`vigiando o grupo ${grupo.jid} a partir de ${estado.desde}`);
  process.exit(0);
}

const novas = db.prepare('SELECT id, chat_jid, content, timestamp, media_type FROM messages WHERE chat_jid = ? AND timestamp >= ? ORDER BY timestamp').all(grupo.jid, estado.desde)
  .filter((m) => !estado.feitos.includes(m.id));
for (const msg of novas) {
  try {
    log(`ok ${msg.id}: ${await processar(msg)}`);
    estado.feitos.push(msg.id);
  } catch (e) {
    estado.falhas[msg.id] = (estado.falhas[msg.id] || 0) + 1;
    log(`erro ${msg.id} (tentativa ${estado.falhas[msg.id]}): ${e.message}`);
    if (estado.falhas[msg.id] < 3) break;       /* tenta de novo na próxima rodada, na ordem */
    estado.feitos.push(msg.id);                  /* desiste depois de 3 */
  }
  estado.desde = msg.timestamp;
  estado.feitos = estado.feitos.slice(-300);
  writeFileSync(ESTADO, JSON.stringify(estado));
}
