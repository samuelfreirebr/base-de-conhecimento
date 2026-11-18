/* ============================================================
   Transforma o que vem de fora em trechos para escolher:
   legenda do YouTube, .txt/.md/.csv e .docx (sem dependência).
   PDF e imagem vão para a IA (ia.js).
   ============================================================ */

import { inflateRawSync } from 'node:zlib';

const erro = (msg, status = 422) => Object.assign(new Error(msg), { status });
const hora = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* junta frases em trechos de ~tamanho caracteres */
function agrupar(partes, tamanho = 650) {
  const saida = [];
  let atual = null;
  for (const p of partes) {
    if (!atual || (atual.t + ' ' + p.t).length > tamanho) { atual = { h: p.h, t: p.t }; saida.push(atual); }
    else atual.t += ' ' + p.t;
  }
  return saida;
}

/* ---------- YouTube ---------- */
export function idDoYoutube(url) {
  const m = String(url).match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export async function legendaDoYoutube(url) {
  const id = idDoYoutube(url);
  if (!id) throw erro('Esse link não parece ser de um vídeo do YouTube.', 400);
  const cab = { 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
  const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=pt`, { headers: cab, signal: AbortSignal.timeout(20000) })).text();
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var\s|<\/script>)/);
  if (!m) throw erro('O YouTube não deixou ler este vídeo agora.');
  const jogador = JSON.parse(m[1]);
  const titulo = jogador.videoDetails?.title || 'Vídeo do YouTube';
  const canal = jogador.videoDetails?.author || '';
  const minutos = Math.round(Number(jogador.videoDetails?.lengthSeconds || 0) / 60);
  const faixas = jogador.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!faixas.length) throw Object.assign(erro('Este vídeo não tem legenda.'), { info: { titulo, canal, minutos } });
  const nota = (f) => (f.languageCode?.startsWith('pt') ? 0 : f.languageCode?.startsWith('en') ? 2 : 4) + (f.kind === 'asr' ? 1 : 0);
  const faixa = [...faixas].sort((a, b) => nota(a) - nota(b))[0];
  const info = { titulo, canal, minutos, idioma: faixa.languageCode, automatica: faixa.kind === 'asr' };

  /* 1º caminho: o arquivo de legenda (o YouTube às vezes devolve vazio) */
  const dados = await fetch(faixa.baseUrl + '&fmt=json3', { headers: cab, signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => null);
  let partes = (dados?.events || [])
    .filter((e) => e.segs)
    .map((e) => ({ h: hora(e.tStartMs || 0), t: e.segs.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim() }))
    .filter((p) => p.t);

  /* sem legenda pública: quem chamou tenta pela IA (servidor.js) */
  if (!partes.length) throw Object.assign(erro('O YouTube não entregou a legenda deste vídeo agora.'), { info });
  return { ...info, trechos: agrupar(partes) };
}

/* ---------- texto puro ---------- */
export function trechosDeTexto(texto) {
  const paragrafos = String(texto).replace(/\r/g, '').split(/\n\s*\n/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return agrupar(paragrafos.map((t, i) => ({ h: `§ ${i + 1}`, t })));
}

/* ---------- .docx: é um zip; o texto está em word/document.xml ---------- */
export function textoDoDocx(buf) {
  const fimCentral = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fimCentral < 0) throw erro('Esse arquivo Word parece corrompido.');
  let p = buf.readUInt32LE(fimCentral + 16);
  const total = buf.readUInt16LE(fimCentral + 10);
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(p + 10), tamanho = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    if (nome === 'word/document.xml') {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const bruto = buf.slice(ini, ini + tamanho);
      const xml = (metodo === 8 ? inflateRawSync(bruto) : bruto).toString('utf8');
      return xml.replace(/<\/w:p>/g, '\n\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
    p += 46 + nl + el + cl;
  }
  throw erro('Não achei texto nesse arquivo Word.');
}
