/* ============================================================
   Revisão espaçada (FSRS 4.5, só o essencial).

   Cada conhecimento guarda: estabilidade (s, em dias), dificuldade
   (dif, 1 a 10), quando volta (volta, AAAA-MM-DD), repetições e
   esquecimentos. "Lembrei" = nota 3, "Esqueci" = nota 1.
   A prioridade encurta o intervalo: o essencial volta mais vezes.
   ============================================================ */

const W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466];
const DECAI = -0.5, FATOR = 19 / 81;
const PESO_PRIORIDADE = { 1: 1.6, 2: 1.3, 3: 1, 4: 0.8, 5: 0.6 };
const DIA = 86400000;

export const hojeISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const somarDias = (iso, n) => hojeISO(new Date(new Date(iso + 'T12:00:00').getTime() + n * DIA));
const limitar = (x, a, b) => Math.min(b, Math.max(a, x));

/* estado inicial: o conhecimento novo volta amanhã */
export const novoEstado = (hoje = hojeISO()) => ({ s: 0, dif: 0, reps: 0, esq: 0, ultima: null, volta: somarDias(hoje, 1) });

export function revisar(estado, lembrou, prioridade = 3, hoje = hojeISO()) {
  const nota = lembrou ? 3 : 1;
  const e = { ...estado };
  if (!e.reps) {
    e.s = W[nota - 1];
    e.dif = limitar(W[4] - (nota - 3) * W[5], 1, 10);
  } else {
    const dias = Math.max(0, (new Date(hoje) - new Date(e.ultima || hoje)) / DIA);
    const R = Math.pow(1 + FATOR * dias / e.s, DECAI);
    e.s = lembrou
      ? e.s * (Math.exp(W[8]) * (11 - e.dif) * Math.pow(e.s, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) + 1)
      : W[11] * Math.pow(e.dif, -W[12]) * (Math.pow(e.s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R));
    const d = e.dif - W[6] * (nota - 3);
    e.dif = limitar(W[7] * W[4] + (1 - W[7]) * d, 1, 10);
  }
  e.reps += 1;
  if (!lembrou) e.esq += 1;
  e.ultima = hoje;
  /* com retenção desejada de 90%, o intervalo é a própria estabilidade */
  const dias = lembrou ? Math.max(1, Math.round(e.s * (PESO_PRIORIDADE[prioridade] || 1))) : 1;
  e.volta = somarDias(hoje, dias);
  return { estado: e, dias };
}
