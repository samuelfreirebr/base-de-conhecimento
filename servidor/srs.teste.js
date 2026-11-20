// node servidor/srs.teste.js — confere a revisão espaçada
import assert from 'node:assert/strict';
import { novoEstado, revisar } from './srs.js';

let e = novoEstado('2026-11-18');
assert.equal(e.volta, '2026-11-19', 'novo volta amanhã');

let r = revisar(e, true, 0, '2026-11-19');
assert.equal(r.dias, 5, '2ª vez: 5 dias');
r = revisar(r.estado, true, 0, r.estado.volta);
assert.equal(r.dias, 10, '3ª vez: 10 dias');
r = revisar(r.estado, true, 0, r.estado.volta);
assert.equal(r.dias, 20, 'vai dobrando');

const quente = revisar(r.estado, true, 3, r.estado.volta).dias;
const frio = revisar(r.estado, true, -2, r.estado.volta).dias;
assert.ok(quente < 40 && 40 < frio, 'temperatura muda o intervalo');

const esq = revisar(r.estado, false, 0, r.estado.volta);
assert.equal(esq.dias, 1, 'esqueceu volta amanhã');
assert.equal(revisar(esq.estado, true, 0, esq.estado.volta).dias, 10, 'esqueceu desce dois degraus');

const parado = revisar(r.estado, true, -3, r.estado.volta);
assert.equal(parado.estado.volta, null, '-3 não volta mais');
assert.equal(parado.estado.parado, true);

const antigo = revisar({ s: 3, dif: 5, reps: 1, esq: 0, ultima: '2026-11-19', volta: '2026-11-22' }, true, 0, '2026-11-22');
assert.equal(antigo.dias, 10, 'estado antigo entra na escada');
console.log('srs ok');
