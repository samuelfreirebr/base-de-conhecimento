// node servidor/push.teste.js — confere a cifra do Web Push decifrando como o aparelho faria (RFC 8291)
import assert from 'node:assert/strict';
import { createECDH, createHmac, createDecipheriv, randomBytes } from 'node:crypto';
process.env.PASTA_DADOS ||= '/tmp';
const { cifrar } = await import('./push.js');

const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const aparelho = createECDH('prime256v1');
const ua = aparelho.generateKeys();
const auth = randomBytes(16);

const msg = JSON.stringify({ titulo: 'Teste', texto: 'Olá, notificação com acento ✅' });
const corpo = cifrar(msg, ua.toString('base64url'), auth.toString('base64url'));

const sal = corpo.subarray(0, 16), rs = corpo.readUInt32BE(16), idlen = corpo[20];
const as = corpo.subarray(21, 21 + idlen), cifrado = corpo.subarray(21 + idlen);
assert.equal(rs, 4096);
const segredo = aparelho.computeSecret(as);
const ikm = hmac(hmac(auth, segredo), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
const prk = hmac(sal, ikm);
const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
const d = createDecipheriv('aes-128-gcm', cek, nonce);
d.setAuthTag(cifrado.subarray(-16));
const claro = Buffer.concat([d.update(cifrado.subarray(0, -16)), d.final()]);
assert.equal(claro.at(-1), 2, 'termina com o delimitador do último bloco');
assert.equal(claro.subarray(0, -1).toString(), msg);
console.log('push ok');
