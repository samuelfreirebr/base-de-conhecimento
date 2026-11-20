/* ============================================================
   Revisão espaçada: escada de intervalos + temperatura.

   AJUSTES
   - DEGRAUS: quantos dias até voltar, a cada vez que você lembra.
     O conhecimento novo volta amanhã (1º degrau); depois sobe um degrau
     por "Lembrei". "Esqueci" volta amanhã e desce dois degraus.
   - TEMPERATURA: a barra de 7 pontos embaixo do lembrete.
     -3 = não lembrar mais; 0 = normal; +3 = lembrar muito mais.
     O número multiplica o intervalo do degrau.
   ============================================================ */

export const DEGRAUS = [1, 5, 10, 20, 40, 80, 160, 320];
export const TEMPERATURA = { '-2': 2, '-1': 1.4, 0: 1, 1: 0.7, 2: 0.5, 3: 0.3 };
const DIA = 86400000;

export const hojeISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const somarDias = (iso, n) => hojeISO(new Date(new Date(iso + 'T12:00:00').getTime() + n * DIA));
const limitar = (x, a, b) => Math.min(b, Math.max(a, x));

/* estado inicial: o conhecimento novo volta amanhã */
export const novoEstado = (hoje = hojeISO()) => ({ degrau: 1, reps: 0, esq: 0, ultima: null, volta: somarDias(hoje, 1) });

export function revisar(estado, lembrou, temp = 0, hoje = hojeISO()) {
  const e = { ...estado };
  /* conhecimentos antigos (sem degrau): sobe um degrau por vez que lembrou */
  let degrau = e.degrau ?? limitar(1 + (e.reps || 0) - (e.esq || 0), 1, DEGRAUS.length - 1);
  temp = limitar(Math.round(Number(temp) || 0), -3, 3);
  e.reps = (e.reps || 0) + 1;
  e.ultima = hoje;
  if (temp === -3) {                       /* não lembrar mais */
    e.parado = true; e.volta = null; e.degrau = degrau;
    return { estado: e, dias: null };
  }
  delete e.parado;
  let dias;
  if (lembrou) {
    dias = Math.max(1, Math.round(DEGRAUS[limitar(degrau, 0, DEGRAUS.length - 1)] * TEMPERATURA[temp]));
    degrau += 1;
  } else {
    dias = 1;
    e.esq = (e.esq || 0) + 1;
    degrau = Math.max(1, degrau - 2);
  }
  e.degrau = limitar(degrau, 1, DEGRAUS.length - 1);
  e.volta = somarDias(hoje, dias);
  return { estado: e, dias };
}
