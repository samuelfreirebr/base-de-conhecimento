/* ============================================================
   Tranca do app. Três jeitos de entrar, basta um:
     · sessão  — cookie assinado, criado na tela /entrar (o app).
     · token   — cabeçalho x-token = TOKEN_API (o MCP do Claude e
                 outros sistemas). Lê, cria e edita; não existe rota
                 de apagar.
     · Basic   — :senha no cabeçalho, para curl e testes.
   Sem SENHA_APP configurada, nega tudo (falha fechado).
   Adaptado da tranca do painel Samuel Freire.
   ============================================================ */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const SENHA = () => process.env.SENHA_APP || '';
const TOKEN = () => process.env.TOKEN_API || '';
const COOKIE = 'base';
const DURACAO_MS = 60 * 24 * 60 * 60 * 1000;   // 60 dias: é um app de celular, não pode pedir senha toda hora

export function iguais(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export const temSenha = () => Boolean(SENHA());
export const senhaCerta = (s) => temSenha() && iguais(String(s || ''), SENHA());

const chave = () => createHmac('sha256', 'sessao-da-base').update(SENHA()).digest();
const assinar = (corpo) => createHmac('sha256', chave()).update(corpo).digest('base64url');

export function criarSessao() {
  const corpo = String(Date.now() + DURACAO_MS) + '.' + randomBytes(9).toString('base64url');
  return corpo + '.' + assinar(corpo);
}

function lerCookie(req, nome) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}

function temSessao(req) {
  if (!temSenha()) return false;
  const p = (lerCookie(req, COOKIE) || '').split('.');
  if (p.length !== 3) return false;
  return iguais(p[2], assinar(p[0] + '.' + p[1])) && Number(p[0]) > Date.now();
}

function temToken(req) {
  return Boolean(TOKEN()) && iguais(String(req.headers['x-token'] || ''), TOKEN());
}

function temBasic(req) {
  const cab = req.headers.authorization || '';
  if (!cab.startsWith('Basic ')) return false;
  const cru = Buffer.from(cab.slice(6), 'base64').toString('utf8');
  return senhaCerta(cru.slice(cru.indexOf(':') + 1));
}

export const liberado = (req) => temSessao(req) || temToken(req) || temBasic(req);

const ehHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
export const cookieDeSessao = (req, token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACAO_MS / 1000}` + (ehHttps(req) ? '; Secure' : '');
export const cookieDeSaida = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/* freio de tentativas: 8 erros seguidos do mesmo endereço = 10 min bloqueado */
const tentativas = new Map();
const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
export function bloqueado(req) {
  const t = tentativas.get(ip(req));
  return t && t.ate > Date.now() ? Math.ceil((t.ate - Date.now()) / 1000) : 0;
}
export function registrarFalha(req) {
  const t = tentativas.get(ip(req)) || { erros: 0, ate: 0 };
  if (++t.erros >= 8) { t.ate = Date.now() + 10 * 60 * 1000; t.erros = 0; }
  tentativas.set(ip(req), t);
  if (tentativas.size > 5000) tentativas.clear();
}
export const limparFalhas = (req) => tentativas.delete(ip(req));
