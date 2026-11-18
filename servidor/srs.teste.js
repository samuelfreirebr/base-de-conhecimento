// node servidor/srs.teste.js — confere a revisão espaçada
import assert from 'node:assert/strict';
import { novoEstado, revisar } from './srs.js';

let e = novoEstado('2026-11-18');
assert.equal(e.volta, '2026-11-19');

let r = revisar(e, true, 3, '2026-11-19');          // 1ª vez, lembrou
assert.ok(r.dias >= 1 && r.dias <= 5, 'primeiro intervalo curto');
const primeiro = r.dias;
r = revisar(r.estado, true, 3, r.estado.volta);       // lembrou de novo
assert.ok(r.dias > primeiro, 'intervalo cresce quando lembra');
const cresceu = r.dias;
r = revisar(r.estado, false, 3, r.estado.volta);      // esqueceu
assert.equal(r.dias, 1, 'esqueceu volta amanhã');
assert.ok(r.estado.s < cresceu, 'estabilidade cai quando esquece');

const alta = revisar(revisar(novoEstado(), true, 5).estado, true, 5).dias;
const baixa = revisar(revisar(novoEstado(), true, 1).estado, true, 1).dias;
assert.ok(alta < baixa, 'prioridade alta volta antes');
console.log('srs ok');
