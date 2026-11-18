/* ============================================================
   A base inteira num arquivo JSON no volume (/dados/base.json).
   Para uma pessoa só, milhares de conhecimentos cabem com folga na
   memória; cada gravação troca o arquivo inteiro de forma atômica
   e guarda a versão de antes em base.anterior.json.
   ponytail: arquivo único; se passar de ~50 mil itens, trocar por
   node:sqlite (já vem no Node, sem dependência).
   ============================================================ */

import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { novoEstado, revisar, hojeISO } from './srs.js';

const PASTA = process.env.PASTA_DADOS || new URL('../dados-local', import.meta.url).pathname;
const ARQ = join(PASTA, 'base.json');
export const PASTA_DADOS = PASTA;
let base = { itens: [], ligacoes: [], resumos: {}, revisoes: {}, lixeira: [], proximoId: 1 };

export async function carregar() {
  try { base = { ...base, ...JSON.parse(await readFile(ARQ, 'utf8')) }; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  return base;
}

let fila = Promise.resolve();
export function salvar() {
  fila = fila.then(async () => {
    await mkdir(PASTA, { recursive: true });
    await writeFile(ARQ + '.tmp', JSON.stringify(base));
    await copyFile(ARQ, join(PASTA, 'base.anterior.json')).catch(() => {});
    await rename(ARQ + '.tmp', ARQ);
  }).catch((e) => console.error('salvar', e));
  return fila;
}

export const tudo = () => base;
export const porId = (id) => base.itens.find((x) => x.id === Number(id));
export const ligacoesDe = (id) => base.ligacoes.filter((l) => l.includes(id)).map((l) => (l[0] === id ? l[1] : l[0]));

/* ---------- texto para busca ---------- */
const PARADAS = new Set('sobre para como mais isso esse essa este esta pelo pela quando quem onde porque entao tambem muito muita voce voces eles elas nosso nossa minha meu seus suas tudo nada cada qual quais algo alguma algum livro video coisa coisas sabe saber lembra lembrar aprendi quero tenho anotei resume resumo explica que com uma uns dos das nos nas pra por sem mas foi ser ter tem vou sei the and'.split(' '));
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const palavras = (s) => [...new Set(semAcento(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !PARADAS.has(w)))];
export const textoTodo = (x) => [x.t, x.c.join(' '), x.f, ...(x.corpo || []).map((b) => (typeof b === 'string' ? b : b.sec || b.cit || b.nota || (b.lista || []).join(' ')))].join(' ');

export function buscar(consulta, limite = 15) {
  const ps = palavras(consulta);
  if (!ps.length) return [];
  return base.itens
    .map((x) => {
      const txt = semAcento(textoTodo(x));
      const pontos = ps.reduce((n, w) => n + (txt.includes(w) ? 1 : 0) + (semAcento(x.t).includes(w) ? 1 : 0) + (semAcento(x.c.join(' ')).includes(w) ? 2 : 0), 0);
      return { x, pontos: pontos + (pontos ? x.p * 0.1 : 0) };
    })
    .filter((r) => r.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite)
    .map((r) => r.x);
}

/* candidatos a ligação: os mais parecidos; sem parecido, os mais recentes */
export function candidatos(texto, limite = 25) {
  const achados = buscar(texto, limite);
  return achados.length ? achados : base.itens.slice(-10);
}

/* a árvore em forma de lista de caminhos, com quantos conhecimentos cada um tem */
export function caminhos() {
  const cont = {};
  for (const x of base.itens) for (let i = 1; i <= x.c.length; i++) { const k = x.c.slice(0, i).join(' > '); cont[k] = (cont[k] || 0) + 1; }
  return cont;
}

export function adicionar({ t, corpo, c, f, o, tipo, p, pIA, extras }) {
  const hoje = hojeISO();
  const item = { id: base.proximoId++, t, corpo: corpo && corpo.length ? corpo : undefined, c, f: f || '', o, tipo, d: hoje, criado: new Date().toISOString(), p, pIA, srs: novoEstado(hoje), ...(extras || {}) };
  base.itens.push(item);
  return item;
}

export function ligar(a, b) {
  if (a === b || !porId(a) || !porId(b)) return;
  if (!base.ligacoes.some((l) => l.includes(a) && l.includes(b))) base.ligacoes.push([a, b]);
}

export function editar(id, campos) {
  const x = porId(id);
  if (!x) return null;
  if (typeof campos.t === 'string' && campos.t.trim()) x.t = campos.t.trim();
  if (Array.isArray(campos.corpo)) x.corpo = campos.corpo;
  if (Array.isArray(campos.c) && campos.c.length) x.c = campos.c.map(String);
  if (typeof campos.f === 'string') x.f = campos.f;
  if (typeof campos.url === 'string') { const u = campos.url.trim(); if (/^https?:\/\/\S+$/i.test(u)) x.url = u; else if (!u) delete x.url; }
  if (['livro', 'video', 'evento', 'conversa', 'nota'].includes(campos.o)) x.o = campos.o;
  if ([1, 2, 3, 4, 5].includes(Number(campos.p))) x.p = Number(campos.p);
  x.editado = new Date().toISOString();
  return x;
}

/* juntar vários num só: o corpo junta tudo (uma seção por original, ou o corpo pronto que vier),
   as ligações passam para o novo e os originais vão para a lixeira com "mescladoEm" */
export function mesclar(ids, { t, c, corpo, p }) {
  const orig = ids.map(Number).map(porId);
  if (orig.length < 2 || orig.some((x) => !x)) return null;
  const primeiro = orig[0];
  const novo = adicionar({
    t: String(t || primeiro.t).trim(), c: Array.isArray(c) && c.length ? c.map(String) : primeiro.c,
    corpo: Array.isArray(corpo) && corpo.length ? corpo : orig.flatMap((x) => [{ sec: x.t }, ...(x.corpo || [])]),
    f: primeiro.f, o: primeiro.o, tipo: 'mesclado', p: [1, 2, 3, 4, 5].includes(Number(p)) ? Number(p) : Math.max(...orig.map((x) => x.p)),
    extras: { ...(orig.find((x) => x.url) ? { url: orig.find((x) => x.url).url } : {}), mesclou: orig.map((x) => x.id) },
  });
  const fora = new Set(orig.map((x) => x.id));
  const vizinhos = new Set(base.ligacoes.filter((l) => l.some((i) => fora.has(i))).flat().filter((i) => !fora.has(i)));
  for (const x of orig) { apagar(x.id); base.lixeira.at(-1).mescladoEm = novo.id; }
  for (const v of vizinhos) ligar(novo.id, v);
  return novo;
}

/* apagar = mandar para a lixeira (fica no arquivo, dá para recuperar) */
export function apagar(id) {
  const i = base.itens.findIndex((x) => x.id === Number(id));
  if (i < 0) return null;
  const [item] = base.itens.splice(i, 1);
  const ligacoes = base.ligacoes.filter((l) => l.includes(item.id));
  base.ligacoes = base.ligacoes.filter((l) => !l.includes(item.id));
  (base.lixeira ||= []).push({ ...item, apagado: new Date().toISOString(), ligacoes });
  return item;
}

/* ---------- Lembrar hoje ---------- */
const POR_DIA = 15;
export function hoje() {
  const h = hojeISO();
  const fila = base.itens
    .filter((x) => x.srs && x.srs.volta <= h && x.srs.ultima !== h)
    .sort((a, b) => b.p - a.p || a.srs.volta.localeCompare(b.srs.volta))
    .slice(0, Math.max(0, POR_DIA - (base.revisoes[h] || 0)))
    .map((x) => x.id);
  let seq = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    const k = hojeISO(d);
    if (base.revisoes[k]) seq++;
    else if (k !== h) break;
    if (seq > 3650) break;
  }
  const ultimos14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return base.revisoes[hojeISO(d)] || 0; });
  return { fila, feitosHoje: base.revisoes[h] || 0, sequencia: seq, ultimos14 };
}

export function marcarRevisao(id, lembrou) {
  const x = porId(id);
  if (!x) return null;
  const r = revisar(x.srs || novoEstado(), Boolean(lembrou), x.p);
  x.srs = r.estado;
  const h = hojeISO();
  base.revisoes[h] = (base.revisoes[h] || 0) + 1;
  return { dias: r.dias, volta: x.srs.volta };
}
