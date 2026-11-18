/* ============================================================
   Toda a IA do app passa por aqui, pelo OpenRouter.
   Chave: OPENROUTER_API_KEY. Modelo: OPENROUTER_MODELO (padrão
   google/gemini-2.5-flash: lê imagem, áudio e PDF, bom em
   português e barato). Sem chave, o app funciona e guarda o que
   chegar em "Sem tema > Para organizar".
   ============================================================ */

export const temIA = () => Boolean(process.env.OPENROUTER_API_KEY);
const MODELO = () => process.env.OPENROUTER_MODELO || 'google/gemini-2.5-flash';

async function chamar(conteudo, { sistema, json = false, tempo = 120000, temperatura = 0.2, extra = {} } = {}) {
  const messages = [];
  if (sistema) messages.push({ role: 'system', content: sistema });
  messages.push({ role: 'user', content: conteudo });
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'x-title': 'Base de conhecimento pessoal' },
    body: JSON.stringify({ model: MODELO(), temperature: temperatura, messages, ...(json ? { response_format: { type: 'json_object' } } : {}), ...extra }),
    signal: AbortSignal.timeout(tempo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `A IA respondeu com erro ${r.status}.`);
  return String(d.choices?.[0]?.message?.content ?? '').trim();
}

function lerJson(txt) {
  try { return JSON.parse(txt); } catch {}
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  throw new Error('A IA não devolveu um formato válido.');
}

/* converte os blocos da IA para o formato do app: texto puro = parágrafo */
const blocos = (lista) => (Array.isArray(lista) ? lista : []).map((b) => {
  if (typeof b === 'string') return b;
  if (b?.p) return String(b.p);
  if (b?.cit) return { cit: String(b.cit) };
  if (b?.nota) return { nota: String(b.nota) };
  if (Array.isArray(b?.lista)) return { lista: b.lista.map(String) };
  return null;
}).filter(Boolean);

/* ---------- organizar um conhecimento novo ---------- */
export async function organizar({ texto, origem, fonte, arvore, candidatos }) {
  const sistema = `Você organiza a base de conhecimento pessoal do Samuel (empresário brasileiro). Ele registra insights de livros, vídeos, eventos, conversas e ideias próprias.
Regras:
- Nunca invente informação. Use só o que está no texto. Corrija apenas pontuação e erros óbvios de transcrição.
- "titulo": uma frase curta (até 140 caracteres) com a ideia principal, em português, como um insight.
- "corpo": o conteúdo completo organizado em blocos, sem perder nada. Blocos possíveis: {"p":"parágrafo"}, {"lista":["item"]}, {"cit":"trecho literal marcado ou citado"}, {"nota":"comentário pessoal do Samuel, quando ele fala em primeira pessoa sobre o que vai fazer"}. Se o texto for só uma frase, "corpo" = [].
- "caminho": 2 ou 3 níveis [tema, galho, sub-galho opcional]. Reaproveite EXATAMENTE os nomes da árvore existente quando servir. Crie nome novo só se nada servir. Nomes curtos (1 a 3 palavras), primeira letra maiúscula. Temas largos (ex.: Negócios, Relacionamento, Saúde, Mente, Finanças, Fé, Família).
- "prioridade": 1 a 5, o quanto isso vale ser lembrado (5 = muda decisões importantes). "motivo": até 12 palavras.
- "ligacoes": ids dos conhecimentos existentes realmente relacionados (0 a 4). Não ligue por semelhança superficial.
- "fonte": se o texto citar livro, autor, vídeo ou pessoa e a fonte informada estiver vazia, preencha; senão repita a informada.
Responda só JSON: {"titulo":"","corpo":[],"caminho":[],"prioridade":3,"motivo":"","ligacoes":[],"fonte":""}`;
  const usuario = `Origem: ${origem || 'não informada'}
Fonte informada: ${fonte || '(vazia)'}

Árvore existente (caminho: quantidade):
${Object.entries(arvore).map(([k, n]) => `${k}: ${n}`).join('\n') || '(vazia, é o primeiro)'}

Conhecimentos existentes para possíveis ligações:
${candidatos.map((x) => `#${x.id} [${x.c.join(' > ')}] ${x.t}`).join('\n') || '(nenhum)'}

TEXTO NOVO:
${texto}`;
  const r = lerJson(await chamar(usuario, { sistema, json: true }));
  const ids = new Set(candidatos.map((x) => x.id));
  return {
    titulo: String(r.titulo || '').trim(),
    corpo: blocos(r.corpo),
    caminho: (Array.isArray(r.caminho) ? r.caminho : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
    prioridade: Math.min(5, Math.max(1, Math.round(Number(r.prioridade) || 3))),
    motivo: String(r.motivo || ''),
    ligacoes: (Array.isArray(r.ligacoes) ? r.ligacoes : []).map(Number).filter((n) => ids.has(n)).slice(0, 4),
    fonte: String(r.fonte || fonte || '').trim(),
  };
}

/* ---------- foto: só o marcado, ou a página toda ---------- */
export async function lerFoto(dataUrl, marcado) {
  const pedido = marcado
    ? `Esta é a foto de uma página (livro, papel, anotação). Extraia SOMENTE os trechos que a pessoa marcou à mão: marca-texto de qualquer cor, sublinhado de caneta ou lápis, colchete ou traço na margem, círculo, seta, asterisco. Transcreva cada trecho marcado por inteiro, fiel ao original, completando a frase se a marcação cortar no meio de uma palavra. Ignore o texto não marcado.
Responda só JSON: {"trechos":["..."],"marcacoes":"descrição curta das marcações encontradas, ex.: sublinhado a lápis e marca-texto amarelo","fonte":"título do livro e autor se aparecerem na página, senão vazio"}. Se não houver nenhuma marcação, devolva "trechos": [].`
    : `Esta é a foto de uma página ou anotação. Transcreva todo o texto que faça sentido, fiel ao original, sem número de página, cabeçalho ou rodapé. Mantenha os parágrafos.
Responda só JSON: {"trechos":["parágrafo 1","parágrafo 2"],"marcacoes":"","fonte":"título do livro e autor se aparecerem, senão vazio"}`;
  const r = lerJson(await chamar([{ type: 'text', text: pedido }, { type: 'image_url', image_url: { url: dataUrl } }], { json: true, temperatura: 0 }));
  return { trechos: (r.trechos || []).map(String).filter((t) => t.trim()), marcacoes: String(r.marcacoes || ''), fonte: String(r.fonte || '') };
}

/* ---------- áudio (WAV 16 kHz mono vindo do navegador) ---------- */
const SEM_FALA = '[sem fala]';
export async function transcrever(wav) {
  const pedido = 'Transcreva fielmente, em português do Brasil, o que a pessoa fala neste áudio. Devolva só as palavras ditas, sem comentários, sem título e sem aspas. Ajuste apenas a pontuação e tire hesitações como "é...", "hum". Nunca invente, complete ou resuma nada. ' + `Se não houver fala humana clara, responda exatamente ${SEM_FALA}`;
  const t = await chamar([{ type: 'text', text: pedido }, { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }], { temperatura: 0 });
  return t.includes(SEM_FALA) ? '' : t;
}

/* ---------- PDF ---------- */
export async function lerPdf(bytes, nome) {
  const pedido = `Extraia o texto deste PDF em trechos (um por seção ou bloco de ideia, no máximo 40 trechos, cada um com até 700 caracteres), fiel ao original, sem cabeçalho, rodapé e número de página. Responda só JSON: {"titulo":"título do documento","trechos":[{"h":"página ou seção, ex.: p. 3","t":"texto"}]}`;
  const r = lerJson(await chamar([{ type: 'text', text: pedido }, { type: 'file', file: { filename: nome || 'arquivo.pdf', file_data: 'data:application/pdf;base64,' + bytes.toString('base64') } }], { json: true, temperatura: 0, tempo: 240000 }));
  return { titulo: String(r.titulo || nome || ''), trechos: (r.trechos || []).map((x) => ({ h: String(x.h || ''), t: String(x.t || '') })).filter((x) => x.t.trim()) };
}

/* ---------- YouTube sem legenda pública: o Gemini assiste pelo link ----------
   Só o Gemini do Google AI Studio aceita link do YouTube no OpenRouter. */
export async function videoDoYoutube(url) {
  const pedido = `Transcreva fielmente a fala deste vídeo, no idioma em que é falado, dividida em trechos de cerca de 1 minuto, cada um com o tempo de início (m:ss). Não resuma e não invente. Responda só JSON: {"titulo":"título do vídeo","trechos":[{"h":"0:00","t":"texto falado"}]}`;
  const r = lerJson(await chamar([{ type: 'text', text: pedido }, { type: 'video_url', video_url: { url } }], {
    json: true, temperatura: 0, tempo: 420000,
    extra: { model: process.env.OPENROUTER_MODELO_VIDEO || 'google/gemini-2.5-flash', provider: { only: ['google-ai-studio'] } },
  }));
  return { titulo: String(r.titulo || 'Vídeo do YouTube'), trechos: (r.trechos || []).map((x) => ({ h: String(x.h || ''), t: String(x.t || '') })).filter((x) => x.t.trim()) };
}

/* ---------- corrigir erros de leitura ou transcrição (só quando o Samuel pede) ---------- */
export async function corrigir(texto) {
  return chamar(`Corrija neste texto apenas: erros de ortografia e acentuação, pontuação, palavras faltando ou trocadas por erro de leitura de foto (OCR) ou de transcrição de áudio, e quebras de linha no meio de frases. Não reescreva, não resuma, não mude o sentido, o estilo nem a ordem. Mantenha os parágrafos. Devolva só o texto corrigido, sem comentários.\n\n${texto}`, { temperatura: 0 });
}

/* ---------- assistente: responde só com a base ---------- */
export async function responder(pergunta, historico, itens) {
  const sistema = `Você é o assistente da base de conhecimento pessoal do Samuel. Ele quer lembrar do que já aprendeu.
Regras:
- Responda em português do Brasil, direto e claro, usando SÓ os conhecimentos fornecidos abaixo. Não use conhecimento externo e não invente.
- Cite cada conhecimento usado no fim da frase como [#id].
- Se nada abaixo responder a pergunta, diga que não encontrou isso na base e sugira registrar.
- Formato: um parágrafo curto; se ajudar, uma lista com "- " no começo de cada item. Sem títulos, sem negrito.`;
  const contexto = itens.map((x) => `#${x.id} | ${x.c.join(' > ')} | fonte: ${x.f || '-'} | prioridade ${x.p}\n${x.t}\n${(x.corpo || []).map((b) => (typeof b === 'string' ? b : b.cit ? 'Trecho: ' + b.cit : b.nota ? 'Anotação: ' + b.nota : (b.lista || []).map((i) => '- ' + i).join('\n'))).join('\n')}`).join('\n\n');
  const conversa = (historico || []).slice(-6).map((m) => `${m.quem === 'eu' ? 'Samuel' : 'Assistente'}: ${m.texto}`).join('\n');
  const resposta = await chamar(`CONHECIMENTOS DA BASE:\n${contexto || '(nenhum encontrado)'}\n\n${conversa ? 'CONVERSA ATÉ AQUI:\n' + conversa + '\n\n' : ''}PERGUNTA: ${pergunta}`, { sistema, temperatura: 0.3 });
  const ids = [...new Set([...resposta.matchAll(/\[#(\d+)\]/g)].map((m) => Number(m[1])))];
  return { resposta, ids };
}

/* ---------- resumo do galho (roda em segundo plano depois de registrar) ---------- */
export async function resumirGalho(caminho, itens) {
  return chamar(`Resuma em até 2 frases, em português, o que o Samuel aprendeu no galho "${caminho}", juntando as ideias abaixo sem inventar nada:\n${itens.map((x) => '- ' + x.t).join('\n')}`, { temperatura: 0.3 });
}
