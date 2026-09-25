#!/usr/bin/env node
/**
 * prova-runtime.mjs — o runtime Node da Fase 2 do BL-74, provado sem nuvem.
 *
 *     node ferramentas/prova-runtime.mjs
 *
 * O CRITÉRIO DE ACEITE DA FASE 2 era "um POST de teste percorre o fluxo inteiro
 * contra uma base Odoo descartável". Não há Odoo descartável — é o plano
 * gratuito, um banco só. Então o Odoo, o WhatsApp e o Vision são FALSOS, em
 * 127.0.0.1, e o que é verdadeiro é todo o resto: o servidor, a fila, a worker
 * thread, a ponte síncrona, a Plataforma Node e os 27 `.gs` de produção.
 *
 * TRÊS PARTES
 *   1. o contrato da Plataforma Node (relógio, bytes, armazenamento, carregador)
 *   2. a ponte síncrona e o Upstash — numa worker thread, porque a ponte
 *      BLOQUEIA, e os servidores falsos precisam do event loop daqui livre
 *   3. ponta a ponta: mensagens do WhatsApp entrando pelo /webhook, até a
 *      devolução gravada no Odoo e a resposta enviada
 *
 * Nada sai de 127.0.0.1. Nenhuma credencial é usada.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(RAIZ, rel)).href);

// ════════════════════════════════════════════════════════════════════════════
// PARTE 2 (roda dentro da worker): ponte síncrona, http e Upstash
// ════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
  const { criarPonte, criarHttp } = await imp('servidor/plataforma/http.mjs');
  const { blob } = await imp('servidor/plataforma/bytes.mjs');
  const { criarArmazenamentoUpstash } = await imp('servidor/plataforma/armazenamento-upstash.mjs');
  const { criarPlataforma } = await imp('servidor/plataforma/index.mjs');
  const { criarArmazenamentoMemoria } = await imp('servidor/plataforma/armazenamento-memoria.mjs');
  const base = `http://127.0.0.1:${workerData.porta}`;
  const h = criarHttp(criarPonte());
  const casos = [];
  const caso = (nome, fn) => { try { const r = fn(); casos.push({ nome, ok: r === true, detalhe: r === true ? '' : String(r) }); } catch (e) { casos.push({ nome, ok: false, detalhe: 'lançou: ' + e.message }); } };

  caso('http: POST JSON síncrono, com a resposta na linha seguinte', () => {
    const r = h.fetch(`${base}/eco`, { method: 'post', contentType: 'application/json', payload: '{"a":1}', muteHttpExceptions: true });
    const j = JSON.parse(r.getContentText());
    return (r.getResponseCode() === 200 && j.metodo === 'POST' && j.tipo === 'application/json' && j.corpo === '{"a":1}') || r.getContentText();
  });
  caso('http: payload-objeto com Blob vira multipart (o upload do MediaService)', () => {
    const b = blob(new Uint8Array([137, 80, 78, 71]), 'image/png', 'a.png');
    const r = h.fetch(`${base}/eco`, { method: 'post', payload: { messaging_product: 'whatsapp', type: 'image/png', file: b }, muteHttpExceptions: true });
    const j = JSON.parse(r.getContentText());
    return (/^multipart\/form-data; boundary=/.test(j.tipo) && j.corpo.includes('filename="a.png"')
      && j.corpo.includes('name="messaging_product"')) || j.tipo;
  });
  caso('http: resposta binária chega íntegra, com o tipo no getBlob()', () => {
    const r = h.fetch(`${base}/bin`, { muteHttpExceptions: true });
    const b = r.getContent();
    return (b.length === 256 && b[255] === 255 && r.getBlob().getContentType() === 'image/png'
      && r.getBlob().getBytes().length === 256) || `${b.length} bytes, tipo ${r.getBlob().getContentType()}`;
  });
  caso('http: sem muteHttpExceptions, 4xx LANÇA — como o UrlFetchApp', () => {
    try { h.fetch(`${base}/404`); return 'não lançou'; } catch (e) { return /returned code 404/.test(e.message) || e.message; }
  });
  caso('http: com muteHttpExceptions, 4xx devolve a resposta', () => h.fetch(`${base}/404`, { muteHttpExceptions: true }).getResponseCode() === 404);
  caso('http: erro de rede lança, com ou sem muteHttpExceptions', () => {
    try { h.fetch('http://127.0.0.1:1/', { muteHttpExceptions: true }); return 'não lançou'; } catch (e) { return /Falha de rede/.test(e.message) || e.message; }
  });
  caso('http: segue redirecionamento por padrão (Assets)', () => {
    const r = h.fetch(`${base}/redireciona`, { muteHttpExceptions: true, followRedirects: true });
    return r.getResponseCode() === 200 || r.getResponseCode();
  });
  caso('http: redirecionamento de teste só aceita 127.0.0.1', () => {
    try { criarHttp(() => ({}), { 'https://graph.facebook.com': 'https://evil.example' }); return 'aceitou'; } catch (e) { return true; }
  });

  // Upstash, contra um falso que fala o protocolo REST dela.
  const up = criarArmazenamentoUpstash({ url: `${base}/upstash`, token: 'tok', http: h });
  caso('upstash: cache com TTL, getAll e remove', () => {
    up.cachePut('a', 'x', 60); up.cachePutAll({ b: 'y', c: 'z' }, 60);
    const todos = up.cacheGetAll(['a', 'b', 'c', 'nada']);
    up.cacheRemove('a');
    return (up.cacheGet('a') === null && todos.b === 'y' && Object.keys(todos).length === 3) || JSON.stringify(todos);
  });
  caso('upstash: propriedades — getProperties devolve tudo, para a varredura por prefixo', () => {
    up.propSet('sessao_ativa_55', '1'); up.propSetAll({ FLOW_CADASTRO_ATIVO: 'true' });
    const todas = up.propGetAll();
    up.propDelete('sessao_ativa_55');
    return (todas.sessao_ativa_55 === '1' && todas.FLOW_CADASTRO_ATIVO === 'true' && up.propGet('sessao_ativa_55') === null) || JSON.stringify(todas);
  });
  caso('upstash: contador soma com HINCRBY (atômico), não com ler-somar-gravar', () => {
    up.propSomar({ uso_urlfetch_x_0: 3 }); up.propSomar({ uso_urlfetch_x_0: 4, msgs_x_servico_0: 1 });
    const todas = up.propGetAll();
    return (todas.uso_urlfetch_x_0 === '7' && todas.msgs_x_servico_0 === '1') || JSON.stringify(todas);
  });
  caso('upstash: trava — só um dono, e só o dono libera', () => {
    const a = up.travaTentar('dados_55', 'A', 5000);
    const b = up.travaTentar('dados_55', 'B', 5000);
    up.travaLiberar('dados_55', 'B');                 // não é o dono: não solta
    const b2 = up.travaTentar('dados_55', 'B', 5000);
    up.travaLiberar('dados_55', 'A');
    const b3 = up.travaTentar('dados_55', 'B', 5000);
    return (a && !b && !b2 && b3) || `a=${a} b=${b} b2=${b2} b3=${b3}`;
  });

  // Plataforma.trava: trava POR CHAVE e as duas políticas de falha.
  const mem = criarArmazenamentoMemoria();
  const P = criarPlataforma({ armazenamento: mem, http: h, env: {}, log: { warn() {} } });
  caso('trava: chaves diferentes não se bloqueiam (o que o Apps Script não tinha)', () => {
    mem.travaTentar('dados_A', 'outra-execução', 60000);
    return P.trava.comTrava('dados_B', 100, () => 'rodou') === 'rodou';
  });
  caso('trava: chave ocupada chama aoFalhar depois da espera', () => {
    const t0 = Date.now();
    const r = P.trava.comTrava('dados_A', 300, () => 'rodou', () => 'desisti');
    return (r === 'desisti' && Date.now() - t0 >= 280) || `r=${r} em ${Date.now() - t0} ms`;
  });
  caso('trava: reentrante na mesma execução, e solta mesmo se fn lançar', () => {
    let dentro = null;
    try { P.trava.comTrava('k', 100, () => { dentro = P.trava.comTrava('k', 100, () => 'ok'); throw new Error('x'); }); } catch (e) { /* esperado */ }
    return (dentro === 'ok' && mem.travaTentar('k', 'outro', 1000)) || `dentro=${dentro}`;
  });

  parentPort.postMessage(casos);
  process.exit(0);
}

// ════════════════════════════════════════════════════════════════════════════
// Daqui para baixo: thread principal
// ════════════════════════════════════════════════════════════════════════════
let falhas = 0;
const mostrar = (casos) => {
  for (const c of casos) {
    if (!c.ok) falhas++;
    console.log(`${c.ok ? '✅' : '❌'} ${c.nome}${c.ok ? '' : '\n     ' + c.detalhe}`);
  }
};
const casosLocais = [];
const caso = async (nome, fn) => {
  try { const r = await fn(); casosLocais.push({ nome, ok: r === true, detalhe: r === true ? '' : String(r) }); }
  catch (e) { casosLocais.push({ nome, ok: false, detalhe: 'lançou: ' + (e.stack || e.message) }); }
};

const { formatar } = await imp('servidor/plataforma/relogio.mjs');
const bytes = await imp('servidor/plataforma/bytes.mjs');
const { criarArmazenamentoMemoria } = await imp('servidor/plataforma/armazenamento-memoria.mjs');
const { criarPlataforma, CHAVES_DE_CONFIG } = await imp('servidor/plataforma/index.mjs');
const { arquivosDoDeploy, compilar, novoContexto, fusoDoProjeto } = await imp('servidor/carregador.mjs');

console.log('\n🧪 Runtime Node — Fase 2 do BL-74\n');
console.log('── 1. O contrato da Plataforma Node ─────────────────────────────\n');

// ── A interface é a mesma do Plataforma.gs ───────────────────────────────
await caso('a Plataforma Node tem todos os métodos do Plataforma.gs, e só eles', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'Plataforma.gs'), 'utf8') + '\n;this.__P = Plataforma;', ctx);
  const gas = ctx.__P;
  const node = criarPlataforma({ armazenamento: criarArmazenamentoMemoria(), http: {}, env: {}, log: console });
  const faltam = [], sobram = [];
  for (const f of Object.keys(gas)) {
    if (!node[f]) { faltam.push(f); continue; }
    for (const m of Object.keys(gas[f])) if (typeof node[f][m] !== 'function') faltam.push(`${f}.${m}`);
    for (const m of Object.keys(node[f])) if (!(m in gas[f])) sobram.push(`${f}.${m}`);
  }
  for (const f of Object.keys(node)) if (!gas[f]) sobram.push(f);
  return (!faltam.length && !sobram.length) || `faltam [${faltam}] sobram [${sobram}]`;
});

// ── O relógio: os padrões Java que o código usa ──────────────────────────
// 2026-01-05T02:07:09Z é 04/01 23:07:09 em São Paulo: vira o DIA, o que pega
// fuso errado. E é janeiro com dia 4: pega M/MM e d/dd trocados.
const INSTANTE = new Date(Date.UTC(2026, 0, 5, 2, 7, 9));
const ESPERADO = {
  'America/Sao_Paulo': { 'yyyy-MM-dd': '2026-01-04', 'H': '23', 'd': '4', 'HH:mm': '23:07',
    'dd/MM/yyyy HH:mm': '04/01/2026 23:07', 'yyyy-MM': '2026-01', 'yyyy-MM-dd HH:mm:ss': '2026-01-04 23:07:09' },
  'UTC': { 'yyyy-MM-dd': '2026-01-05', 'H': '2', 'd': '5', 'HH:mm': '02:07',
    'dd/MM/yyyy HH:mm': '05/01/2026 02:07', 'yyyy-MM': '2026-01', 'yyyy-MM-dd HH:mm:ss': '2026-01-05 02:07:09' },
};
await caso('relógio: todo padrão de data que os .gs usam tem caso aqui', () => {
  const usados = new Set();
  for (const arq of arquivosDoDeploy()) {
    const fonte = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    for (const m of fonte.matchAll(/relogio\.formatar\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g)) usados.add(m[1]);
  }
  const semCaso = [...usados].filter((p) => !(p in ESPERADO.UTC));
  return (usados.size > 0 && !semCaso.length) || `padrão sem caso: ${semCaso.join(', ')} — acrescente em ESPERADO`;
});
await caso('relógio: formatar dá o mesmo que o Utilities.formatDate (São Paulo e UTC)', () => {
  const erros = [];
  for (const [fuso, casos] of Object.entries(ESPERADO)) {
    for (const [fmt, esperado] of Object.entries(casos)) {
      const veio = formatar(INSTANTE, fuso, fmt);
      if (veio !== esperado) erros.push(`${fuso} "${fmt}" → ${veio} (esperado ${esperado})`);
    }
  }
  return !erros.length || erros.join('; ');
});
await caso('relógio: padrão desconhecido LANÇA, em vez de sair errado em silêncio', () => {
  try { formatar(INSTANTE, 'UTC', 'EEE, dd MMM'); return 'não lançou'; } catch (e) { return /não é suportado/.test(e.message) || e.message; }
});
await caso('relógio: aceita Date vinda do contexto dos .gs (outro realm)', () => {
  const d = vm.runInContext('new Date(Date.UTC(2026, 0, 5, 2, 7, 9))', vm.createContext({}));
  return formatar(d, 'UTC', 'yyyy-MM-dd') === '2026-01-05';
});
await caso('fuso: o do appsscript.json, e os getters de Date dos .gs obedecem', () => {
  const fuso = fusoDoProjeto();
  process.env.TZ = fuso;
  const dia = vm.runInContext('new Date(Date.UTC(2026, 0, 5, 2, 7, 9)).getDate()', vm.createContext({}));
  return (fuso === 'America/Sao_Paulo' && dia === 4) || `fuso=${fuso}, getDate()=${dia} (esperado 4)`;
});

// ── Bytes ────────────────────────────────────────────────────────────────
await caso('bytes: base64 ida e volta, com array com sinal do Apps Script', () => {
  const b64 = bytes.paraBase64([-119, 80, 78, 71]);           // 0x89 como -119
  const volta = bytes.deBase64(b64);
  return (b64 === 'iVBORw==' && volta[0] === 137) || `${b64} / ${volta[0]}`;
});
await caso('bytes: blob com os métodos que o MediaService usa', () => {
  const b = bytes.blob(bytes.deBase64('aGVsbG8='), 'text/plain', 'x.txt');
  return (b.getContentType() === 'text/plain' && b.getName() === 'x.txt' && b.getBytes().length === 5
    && b.getDataAsString() === 'hello') || 'blob incompleto';
});

// ── Armazenamento em memória ─────────────────────────────────────────────
await caso('memória: TTL do cache vence, put renova, e o teto é 6 h', () => {
  let agora = 0;
  const m = criarArmazenamentoMemoria({ agora: () => agora });
  m.cachePut('a', '1', 60);
  agora = 59000; m.cachePut('a', '2', 60);        // renova
  agora = 100000; const vivo = m.cacheGet('a');
  agora = 200000; const morto = m.cacheGet('a');
  m.cachePut('b', '1', 999999); agora += 21600 * 1000 + 1;
  return (vivo === '2' && morto === null && m.cacheGet('b') === null) || `vivo=${vivo} morto=${morto}`;
});
await caso('propriedades: gravada vence o ambiente; ambiente só para chaves de config', () => {
  const m = criarArmazenamentoMemoria();
  const env = { WEBHOOK_SECRET: 'do-ambiente', PATH: '/usr/bin', ODOO_URL: 'https://x' };
  const P = criarPlataforma({ armazenamento: m, http: {}, env, log: console });
  m.propSet('WEBHOOK_SECRET', 'gravado');
  const todas = P.propriedades.getProperties();
  return (P.propriedades.getProperty('WEBHOOK_SECRET') === 'gravado' && P.propriedades.getProperty('ODOO_URL') === 'https://x'
    && P.propriedades.getProperty('PATH') === null && !('PATH' in todas) && todas.ODOO_URL === 'https://x'
    && CHAVES_DE_CONFIG.includes('ODOO_API_KEY')) || JSON.stringify(todas);
});

// ── Carregador ───────────────────────────────────────────────────────────
await caso('carregador: carrega os mesmos .gs que o clasp manda, sem o Plataforma.gs', () => {
  const lista = arquivosDoDeploy();
  const ign = fs.readFileSync(path.join(RAIZ, '.claspignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const erros = [];
  if (lista.includes('Plataforma.gs')) erros.push('carregou o Plataforma.gs');
  if (lista.some((a) => ign.includes(a))) erros.push('carregou arquivo que o .claspignore corta');
  if (lista[0] !== 'Config.gs') erros.push('Config.gs não é o primeiro');
  if (lista.length < 20) erros.push(`só ${lista.length} arquivos`);
  return !erros.length || erros.join('; ');
});
await caso('carregador: cada execução começa do zero — estado de módulo não vaza', () => {
  const scripts = compilar();
  const globais = () => ({ Plataforma: criarPlataforma({ armazenamento: criarArmazenamentoMemoria(), http: {}, env: {}, log: console }),
    console: { log() {}, warn() {}, error() {} }, Logger: { log() {} } });
  const a = novoContexto(scripts, globais());
  // Os três que a revisão de 24/09 apontou como vazamento numa worker longa.
  vm.runInContext("Utils._mensagemAtualId = 'wamid.DE-OUTRA-PESSOA'; OdooService._camposGravaveis = { x: false }; Utils._chamadasExternas = 99;", a);
  const b = novoContexto(scripts, globais());
  // `_camposGravaveis` nasce indefinido (é criado na primeira consulta).
  const vazou = vm.runInContext("JSON.stringify([Utils._mensagemAtualId, OdooService._camposGravaveis === undefined, Utils._chamadasExternas])", b);
  return vazou === '[null,true,0]' || `herdou (mensagemAtualId, camposGravaveis indefinido?, chamadas): ${vazou}`;
});

mostrar(casosLocais.splice(0));

// ════════════════════════════════════════════════════════════════════════════
// Servidores falsos: eco, Upstash, Odoo, Graph (WhatsApp) e Vision
// ════════════════════════════════════════════════════════════════════════════
const PNG = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const estado = { enviados: [], criados: [], upstash: new Map(), hash: new Map(), comandos: [] };

const DIZIMISTA = { id: 7, x_name: 'Ana', x_studio_nome_completo: 'Ana Souza', x_studio_partner_phone: '5586999990001',
  x_studio_value: 50, x_studio_comunidade: [1, 'Matriz'], x_studio_dia_preferido: 10, x_active: true,
  x_studio_responsavel: false, x_studio_notificacao_ativa: true };
const COMUNIDADE = { id: 1, x_name: 'Matriz', x_studio_chave_pix: 'pix@paroquia.org', x_studio_banco: 'Banco do Brasil',
  x_studio_titular_conta: 'Paróquia N. S. Aparecida' };
const TABELAS = { x_dizimista: [DIZIMISTA], x_comunidade: [COMUNIDADE], x_contato_bot: [{ id: 1, x_name: '5586999990001' }],
  x_parametros: [{ id: 1, x_name: 'Padrão' }] };

const casaDominio = (reg, dominio) => {
  if (!Array.isArray(dominio) || dominio.some((d) => d === '|')) return true;   // OU: não filtra
  return dominio.filter(Array.isArray).every(([campo, op, v]) => {
    if (!(campo in reg)) return true;
    const r = Array.isArray(reg[campo]) ? reg[campo][0] : reg[campo];
    if (op === '=') return r === v;
    if (op === 'in') return v.includes(r);
    return true;
  });
};

function odoo(corpo) {
  const [, , , modelo, metodo, args = [], kwargs = {}] = corpo.params.args;
  if (modelo === 'ir.model.fields') return [{ id: 1, related: false, readonly: false, ttype: 'char' }];
  if (metodo === 'create') { estado.criados.push({ modelo, dados: args[0] }); return estado.criados.length + 100; }
  if (metodo === 'write') return true;
  const regs = (TABELAS[modelo] || []).filter((r) => casaDominio(r, args[0]));
  if (metodo === 'search_count') return regs.length;
  if (metodo === 'search_read' || metodo === 'read') return regs.slice(0, kwargs.limit || undefined);
  return [];
}

function upstash(cmd) {
  const [c, ...a] = cmd;
  const u = estado.upstash;
  switch (c) {
    case 'GET': return u.get(a[0]) ?? null;
    case 'MGET': return a.map((k) => u.get(k) ?? null);
    case 'SET': {
      if (a.includes('NX') && u.has(a[0])) return null;
      u.set(a[0], a[1]); return 'OK';
    }
    case 'DEL': { let n = 0; a.forEach((k) => { if (u.delete(k)) n++; }); return n; }
    case 'HGET': return estado.hash.get(a[1]) ?? null;
    case 'HSET': { for (let i = 1; i < a.length; i += 2) estado.hash.set(a[i], a[i + 1]); return 1; }
    case 'HDEL': return estado.hash.delete(a[1]) ? 1 : 0;
    case 'HINCRBY': { const n = (parseInt(estado.hash.get(a[1]), 10) || 0) + Number(a[2]); estado.hash.set(a[1], String(n)); estado.comandos.push('HINCRBY'); return n; }
    case 'HGETALL': return [...estado.hash].flat();
    case 'EVAL': { const [, , chave, dono] = a; if (u.get(chave) === dono) { u.delete(chave); return 1; } return 0; }
    default: throw new Error(`comando não simulado: ${c}`);
  }
}

// ── Cloud Tasks falso: cria a tarefa, recusa nome repetido (409) e ENTREGA ao
// worker de verdade, repetindo quando ele responde 503 (pessoa ocupada) —
// como a fila real, com política de nova tentativa.
estado.tarefas = new Map();
estado.entregas = [];
estado.filaFora = false;
function tarefaFalsa(req, corpo) {
  if (estado.filaFora) return [{ error: { message: 'indisponível' } }, 503];
  if (req.headers.authorization !== 'Bearer token-da-conta-webhook') return [{ error: 'sem token' }, 401];
  const { task } = JSON.parse(corpo);
  if (estado.tarefas.has(task.name)) return [{ error: { status: 'ALREADY_EXISTS' } }, 409];
  const reg = { ...task, tentativas: 0, respostas: [] };
  estado.tarefas.set(task.name, reg);
  const conteudo = Buffer.from(task.httpRequest.body, 'base64').toString('utf8');
  estado.entregas.push((async () => {
    for (let i = 0; i < 60; i++) {
      reg.tentativas++;
      const r = await fetch(task.httpRequest.url, { method: 'POST', headers: task.httpRequest.headers, body: conteudo });
      reg.respostas.push(r.status);
      await r.text();
      if (r.status !== 503 && r.status !== 500) return;
      await new Promise((ok) => setTimeout(ok, 30));
    }
  })());
  return [{ name: task.name }, 200];
}
const entregasTerminarem = async () => { while (estado.entregas.length) await estado.entregas.shift(); };

const TEXTO_OCR = 'Pix enviado\nValor R$ 50,00\n24/09/2026 10:00\nPara\nParóquia N. S. Aparecida\n' +
                  'Chave Pix\npix@paroquia.org\nInstituição\nBanco do Brasil\nDe\nAna Souza';

const falsos = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    const corpo = Buffer.concat(partes).toString('utf8');
    const json = (o, codigo = 200) => { res.writeHead(codigo, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname === '/eco') return json({ metodo: req.method, tipo: req.headers['content-type'], corpo });
      if (u.pathname === '/bin') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
      if (u.pathname === '/404') return json({ erro: 'não' }, 404);
      if (u.pathname === '/redireciona') { res.writeHead(302, { location: '/eco' }); return res.end(); }
      if (u.pathname === '/upstash') return json({ result: upstash(JSON.parse(corpo)) });
      if (u.pathname === '/upstash/pipeline') return json(JSON.parse(corpo).map((c) => ({ result: upstash(c) })));
      if (u.pathname === '/meta/computeMetadata/v1/instance/service-accounts/default/token') {
        if (req.headers['metadata-flavor'] !== 'Google') return json({ erro: 'sem Metadata-Flavor' }, 403);
        return json({ access_token: 'token-da-conta-webhook', expires_in: 3600 });
      }
      if (u.pathname.startsWith('/tasks-api/v2/')) return json(...tarefaFalsa(req, corpo));
      if (u.pathname.startsWith('/odoo')) return json({ jsonrpc: '2.0', id: null, result: odoo(JSON.parse(corpo)) });
      if (u.pathname.startsWith('/vision')) return json({ responses: [{ fullTextAnnotation: { text: TEXTO_OCR } }] });
      if (u.pathname.startsWith('/graph')) {
        const resto = u.pathname.replace(/^\/graph\/v[\d.]+\//, '');
        if (resto === 'midia-bin') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(PNG); }
        if (/\/messages$/.test(resto)) {
          const msg = JSON.parse(corpo);
          if (msg.status === 'read') return json({ success: true });
          estado.enviados.push(msg);
          return json({ messaging_product: 'whatsapp', contacts: [{ input: msg.to, wa_id: msg.to }], messages: [{ id: `wamid.S${estado.enviados.length}` }] });
        }
        if (/\/media$/.test(resto)) return json({ id: 'MIDIA_ENVIADA' });
        // GET /<media_id> → a URL do arquivo
        return json({ url: `https://graph.facebook.com/v21.0/midia-bin`, mime_type: 'image/jpeg', id: resto });
      }
      json({ erro: `rota falsa desconhecida: ${u.pathname}` }, 404);
    } catch (e) {
      json({ erro: e.message }, 500);
    }
  });
});
await new Promise((ok) => falsos.listen(0, '127.0.0.1', ok));
const PORTA_FALSOS = falsos.address().port;
const FALSOS = `http://127.0.0.1:${PORTA_FALSOS}`;

// ── Parte 2, na worker ──────────────────────────────────────────────────
console.log('\n── 2. A ponte síncrona, o http e o Upstash (numa worker) ────────\n');
const casosWorker = await new Promise((ok, falha) => {
  const w = new Worker(new URL(import.meta.url), { workerData: { porta: PORTA_FALSOS } });
  w.on('message', ok);
  w.on('error', falha);
});
mostrar(casosWorker);

// ════════════════════════════════════════════════════════════════════════════
// PARTE 3: ponta a ponta, pelo servidor de verdade
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Ponta a ponta: /webhook → .gs → Odoo e WhatsApp falsos ────\n');

const { iniciar } = await imp('servidor/index.mjs');
const SEGREDO = 'segredo-de-teste';
const servidor = await iniciar({ porta: 0, env: {
  PAPEL: 'local', ARMAZENAMENTO: 'memoria', PROCESSADORES: '1', CRON_TOKEN: 'cron-teste',
  WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '111', VERIFY_TOKEN: 'verifica', WEBHOOK_SECRET: SEGREDO,
  ODOO_URL: `${FALSOS}/odoo`, ODOO_DATABASE: 'falso', ODOO_UID: '13', ODOO_API_KEY: 'chave',
  GOOGLE_VISION_API_KEY: 'vision', NOTIFICACOES_ATIVAS: 'false',
  PLATAFORMA_REDIRECIONAR: JSON.stringify({
    'https://graph.facebook.com': `${FALSOS}/graph`,
    'https://vision.googleapis.com': `${FALSOS}/vision`,
  }),
} });
const SERV = `http://127.0.0.1:${servidor.porta}`;

const DE = '5586999990001';
let seq = 0;
const envelope = (mensagem) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { display_phone_number: '5586900000000', phone_number_id: '111' },
  contacts: [{ wa_id: DE, profile: { name: 'Ana' } }],
  messages: [{ from: DE, id: mensagem.id || `wamid.E${++seq}`, timestamp: String(1790000000 + seq), ...mensagem }] } }] }] });
const postar = async (mensagem, token = SEGREDO) => {
  const r = await fetch(`${SERV}/webhook?token=${token}`, { method: 'POST', body: envelope(mensagem), headers: { 'content-type': 'application/json' } });
  return r.text();
};
const textos = () => estado.enviados.map((m) => JSON.stringify(m));

await caso('GET /webhook responde o desafio da Meta com o VERIFY_TOKEN certo', async () => {
  const r = await (await fetch(`${SERV}/webhook?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=4242`)).text();
  return r === '4242' || r;
});
await caso('POST sem o segredo é recusado e não processa nada', async () => {
  const antes = estado.enviados.length;
  const r = await postar({ type: 'text', text: { body: 'oi' } }, 'errado');
  return (r === 'Forbidden' && estado.enviados.length === antes) || `${r}, enviou ${estado.enviados.length - antes}`;
});
await caso('"oi" de dizimista conhecido: responde pelo WhatsApp', async () => {
  const antes = estado.enviados.length;
  const r = await postar({ type: 'text', text: { body: 'oi' } });
  return (r === 'OK' && estado.enviados.length > antes && estado.enviados.at(-1).to === DE) || `${r}, ${estado.enviados.length - antes} envio(s)`;
});
await caso('botão "Dízimo": manda os dados de pagamento (card PIX)', async () => {
  const antes = estado.enviados.length;
  await postar({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'btn_devolver_dizimo', title: 'Dízimo' } } });
  const novos = textos().slice(antes).join('\n');
  return /pix@paroquia\.org/.test(novos) || `sem os dados de pagamento: ${novos.slice(0, 200)}`;
});
await caso('comprovante: baixa a mídia, lê pelo Vision, grava no Odoo e confirma', async () => {
  const antes = estado.enviados.length;
  await postar({ id: 'wamid.COMPROVANTE', type: 'image', image: { id: 'MIDIA_COMPROVANTE', mime_type: 'image/jpeg', sha256: 'x' } });
  const dev = estado.criados.find((c) => c.modelo === 'x_devolucao');
  const novos = textos().slice(antes).join('\n');
  if (!dev) return `não gravou devolução. Mensagens: ${novos.slice(0, 300)}`;
  if (dev.dados.x_studio_value !== 50) return `valor gravado ${dev.dados.x_studio_value}`;
  if (dev.dados.x_studio_dizimista !== 7) return `dizimista ${dev.dados.x_studio_dizimista}`;
  if (!dev.dados.x_studio_comprovante) return 'sem o comprovante anexado';
  return /Comprovante recebido/.test(novos) || `não confirmou: ${novos.slice(0, 300)}`;
});
await caso('a mesma mensagem reentregue pela Meta não grava de novo (dedup no cache)', async () => {
  const antes = estado.criados.filter((c) => c.modelo === 'x_devolucao').length;
  await postar({ id: 'wamid.COMPROVANTE', type: 'image', image: { id: 'MIDIA_COMPROVANTE', mime_type: 'image/jpeg', sha256: 'x' } });
  const depois = estado.criados.filter((c) => c.modelo === 'x_devolucao').length;
  return depois === antes || `gravou ${depois - antes} a mais`;
});
await caso('/cron sem o token é recusado', async () => {
  const r = await fetch(`${SERV}/cron/executarNotificacoesDiarias`, { method: 'POST' });
  return r.status === 403 || r.status;
});
await caso('/cron com o token roda a rotina de notificações inteira', async () => {
  const r = await fetch(`${SERV}/cron/executarNotificacoesDiarias`, { method: 'POST', headers: { 'x-cron-token': 'cron-teste' } });
  return (r.status === 200 && (await r.text()) === 'OK') || r.status;
});
await caso('/cron não executa função que não é agendada', async () => {
  const r = await fetch(`${SERV}/cron/limparTodasSessoes`, { method: 'POST', headers: { 'x-cron-token': 'cron-teste' } });
  return r.status === 500 || r.status;
});
await caso('/saude diz o fuso e o armazenamento', async () => {
  const s = await (await fetch(`${SERV}/saude`)).json();
  return (s.ok && s.fuso === 'America/Sao_Paulo' && s.armazenamento === 'memoria') || JSON.stringify(s);
});
await caso('memória com 2 processadores é recusada (cache e trava não seriam compartilhados)', async () => {
  try { await iniciar({ porta: 0, env: { ARMAZENAMENTO: 'memoria', PROCESSADORES: '2' } }); return 'subiu'; }
  catch (e) { return /exige PROCESSADORES=1/.test(e.message) || e.message; }
});

mostrar(casosLocais.splice(0));

// ════════════════════════════════════════════════════════════════════════════
// PARTE 4 (Fase 3): webhook → Cloud Tasks → worker, com trava por pessoa
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. A fila: webhook público → Cloud Tasks → worker privado ─────\n');

const ENV_WORKER = {
  PAPEL: 'worker', ARMAZENAMENTO: 'upstash', PROCESSADORES: '2',
  UPSTASH_REDIS_REST_URL: `${FALSOS}/upstash`, UPSTASH_REDIS_REST_TOKEN: 'tok',
  WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '111', WEBHOOK_SECRET: SEGREDO,
  ODOO_URL: `${FALSOS}/odoo`, ODOO_DATABASE: 'falso', ODOO_UID: '13', ODOO_API_KEY: 'chave',
  GOOGLE_VISION_API_KEY: 'vision', NOTIFICACOES_ATIVAS: 'false',
  PLATAFORMA_REDIRECIONAR: JSON.stringify({
    'https://graph.facebook.com': `${FALSOS}/graph`,
    'https://vision.googleapis.com': `${FALSOS}/vision`,
  }),
};
const worker = await iniciar({ porta: 0, env: ENV_WORKER });
// O App Secret do app da Meta: é com ele que ela assina cada POST (Fase 5).
const APP_SECRET = 'app-secret-de-teste';
const { createHmac } = await import('node:crypto');
const assinar = (corpo, segredo = APP_SECRET) => 'sha256=' + createHmac('sha256', segredo).update(Buffer.from(corpo, 'utf8')).digest('hex');
const WORKER = `http://127.0.0.1:${worker.porta}`;
const webhookSrv = await iniciar({ porta: 0, env: {
  PAPEL: 'webhook', META_APP_SECRET: APP_SECRET, VERIFY_TOKEN: 'verifica',
  FILA_PROJETO: 'projeto', FILA_REGIAO: 'southamerica-east1', FILA_NOME: 'mensagens',
  WORKER_URL: WORKER, INVOCADOR_SA: 'invocador@projeto.iam.gserviceaccount.com',
  TASKS_API: `${FALSOS}/tasks-api`, METADADOS_URL: `${FALSOS}/meta`,
} });
const WEBHOOK = `http://127.0.0.1:${webhookSrv.porta}`;

// Um envelope com remetente e horário escolhidos — o da parte 3 é fixo em DE.
const envelopeDe = (de, mensagem, ts) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { display_phone_number: '5586900000000', phone_number_id: '111' },
  contacts: [{ wa_id: de }], messages: [{ from: de, id: `wamid.F${++seq}`, timestamp: String(ts), ...mensagem }] } }] }] });
// Como a Meta: assinatura no cabeçalho, nada na URL.
const postarFila = (corpo, assinatura = assinar(corpo)) =>
  fetch(`${WEBHOOK}/webhook`, { method: 'POST', body: corpo,
    headers: { 'content-type': 'application/json', ...(assinatura ? { 'x-hub-signature-256': assinatura } : {}) } });

await caso('webhook: GET da Meta verificado sem os .gs', async () => {
  const r = await (await fetch(`${WEBHOOK}/webhook?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=77`)).text();
  const errado = await (await fetch(`${WEBHOOK}/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=77`)).text();
  return (r === '77' && errado === 'Forbidden') || `${r} / ${errado}`;
});
await caso('webhook: sem assinatura, assinatura errada, corpo adulterado ou só o ?token= antigo → 401, nada enfileirado', async () => {
  const antes = estado.tarefas.size;
  const corpo = envelopeDe('5586999990002', { type: 'text', text: { body: 'oi' } }, 1790000100);
  const adulterado = corpo.replace('"oi"', '"transferir tudo"');
  const r = [
    await postarFila(corpo, null),                                   // sem cabeçalho
    await postarFila(corpo, assinar(corpo, 'outro-segredo')),         // segredo errado
    await postarFila(adulterado, assinar(corpo)),                      // assinatura de OUTRO corpo
    await fetch(`${WEBHOOK}/webhook?token=${SEGREDO}`, { method: 'POST', body: corpo }), // o jeito antigo
  ].map((x) => x.status);
  return (r.every((s) => s === 401) && estado.tarefas.size === antes) || `status ${r.join(',')}; ${estado.tarefas.size - antes} tarefa(s)`;
});
await caso('webhook: responde na hora; a tarefa leva token OIDC do invocador para o worker', async () => {
  const antes = estado.enviados.length;
  const t0 = Date.now();
  const r = await postarFila(envelopeDe('5586999990001', { type: 'text', text: { body: 'oi' } }, 1790000200));
  const ms = Date.now() - t0;
  const tarefa = [...estado.tarefas.values()].at(-1);
  await entregasTerminarem();
  const erros = [];
  if (r.status !== 200 || (await r.text()) !== 'OK') erros.push(`webhook respondeu ${r.status}`);
  if (!tarefa || !/\/tasks\/[0-9a-f]{64}$/.test(tarefa.name)) erros.push('nome da tarefa não é o SHA-256 do corpo');
  if (tarefa && tarefa.httpRequest.oidcToken.serviceAccountEmail !== 'invocador@projeto.iam.gserviceaccount.com') erros.push('OIDC de outra conta');
  if (tarefa && tarefa.httpRequest.oidcToken.audience !== WORKER) erros.push('audiência errada');
  if (tarefa && tarefa.httpRequest.url !== `${WORKER}/processar`) erros.push(`url ${tarefa.httpRequest.url}`);
  if (estado.enviados.length <= antes) erros.push('o worker não respondeu pelo WhatsApp');
  return !erros.length || `${erros.join('; ')} (webhook em ${ms} ms)`;
});
await caso('webhook: reentrega idêntica da Meta é recusada pela fila (409) e processada uma vez só', async () => {
  const corpo = envelopeDe('5586999990001', { type: 'text', text: { body: 'oi' } }, 1790000300);
  const antes = estado.enviados.length;
  const r1 = await postarFila(corpo);
  await entregasTerminarem();
  const depoisDaPrimeira = estado.enviados.length;
  const r2 = await postarFila(corpo);
  await entregasTerminarem();
  return (r1.status === 200 && r2.status === 200 && depoisDaPrimeira > antes && estado.enviados.length === depoisDaPrimeira)
    || `1ª ${r1.status}, 2ª ${r2.status}; envios ${depoisDaPrimeira - antes} e depois +${estado.enviados.length - depoisDaPrimeira}`;
});
await caso('webhook: fila fora do ar → 500, e a Meta reenvia (o Apps Script perderia a mensagem)', async () => {
  estado.filaFora = true;
  const r = await postarFila(envelopeDe('5586999990001', { type: 'text', text: { body: 'oi' } }, 1790000400));
  estado.filaFora = false;
  return r.status === 500 || r.status;
});

// ── A corrida do BL-20/BL-29 ─────────────────────────────────────────────
// Uma pessoa no passo do NOME manda duas respostas quase juntas — do mesmo
// segundo, para o filtro de ordem do BL-29 não recusar nenhuma. Os dois
// processadores pegam as duas ao mesmo tempo. Sem trava por pessoa, as duas
// leem "aguardando nome" e as duas gravam em `nome`: o apelido se perde. Com a
// trava, a segunda volta "ocupado", a fila repete, e ela cai no passo seguinte.
await caso('corrida: duas respostas simultâneas no cadastro não perdem campo (BL-20)', async () => {
  const C = '5586999990077';
  estado.upstash.set(`c:estado_${C}`, 'AGUARDANDO_NOME');
  estado.upstash.set(`c:dados_${C}`, JSON.stringify({ comunidadeId: 1, comunidadeNome: 'Matriz' }));
  estado.upstash.set(`c:contato_${C}`, '1');           // já conhecido: sem boas-vindas
  estado.upstash.set(`c:sessao_inicio_${C}`, String(Date.now()));
  await Promise.all([
    postarFila(envelopeDe(C, { type: 'text', text: { body: 'Ana Maria Souza' } }, 1790000500)),
    postarFila(envelopeDe(C, { type: 'text', text: { body: 'Aninha Souza' } }, 1790000500)),
  ]);
  await entregasTerminarem();
  const dados = JSON.parse(estado.upstash.get(`c:dados_${C}`) || '{}');
  const ocupados = [...estado.tarefas.values()].filter((t) => t.respostas.includes(503)).length;
  return (dados.nome && dados.nomeUsual && estado.upstash.get(`c:estado_${C}`) === 'AGUARDANDO_DATA_NASCIMENTO')
    || `nome=${dados.nome} nomeUsual=${dados.nomeUsual} estado=${estado.upstash.get(`c:estado_${C}`)} (${ocupados} tarefa(s) esperaram a vez)`;
});
await caso('trava por pessoa: pessoas diferentes NÃO se esperam', async () => {
  const antes = [...estado.tarefas.values()].filter((t) => t.respostas.includes(503)).length;
  await Promise.all(['5586999990081', '5586999990082'].map((de) => {
    estado.upstash.set(`c:contato_${de}`, '1');
    return postarFila(envelopeDe(de, { type: 'text', text: { body: 'oi' } }, 1790000600));
  }));
  await entregasTerminarem();
  const depois = [...estado.tarefas.values()].filter((t) => t.respostas.includes(503)).length;
  return depois === antes || `${depois - antes} tarefa(s) de pessoas diferentes esperaram`;
});
await caso('worker: agendamento sem CRON_TOKEN (quem protege é o IAM do Cloud Run)', async () => {
  const r = await fetch(`${WORKER}/cron/verificarSessoesAbandonadas`, { method: 'POST' });
  return r.status === 200 || r.status;
});
await caso('worker exige Upstash: memória não seria compartilhada entre instâncias', async () => {
  try { await iniciar({ porta: 0, env: { PAPEL: 'worker', ARMAZENAMENTO: 'memoria' } }); return 'subiu'; }
  catch (e) { return /exige ARMAZENAMENTO=upstash/.test(e.message) || e.message; }
});
await caso('webhook sem META_APP_SECRET não sobe (recusaria toda mensagem)', async () => {
  try { await iniciar({ porta: 0, env: { PAPEL: 'webhook', META_APP_SECRET: '' } }); return 'subiu'; }
  catch (e) { return /exige META_APP_SECRET/.test(e.message) || e.message; }
});
await caso('assinatura: a comparação é sobre os BYTES, com acento e emoji', async () => {
  const { assinaturaValida } = await imp('servidor/index.mjs');
  const corpo = Buffer.from('{"text":{"body":"Olá, paróquia 🙏"}}', 'utf8');
  const sig = 'sha256=' + createHmac('sha256', 's').update(corpo).digest('hex');
  return (assinaturaValida(corpo, sig, 's') && assinaturaValida(corpo, sig.toUpperCase().replace('SHA256=', 'sha256='), 's')
    && !assinaturaValida(corpo, sig, '') && !assinaturaValida(corpo, 'sha1=abc', 's')) || 'falhou';
});
await caso('fila: endereço da API ou dos metadados só troca para 127.0.0.1 (o token não sai)', async () => {
  const { criarFila } = await imp('servidor/fila.mjs');
  const base = { FILA_PROJETO: 'p', FILA_REGIAO: 'r', FILA_NOME: 'q', WORKER_URL: 'https://w', INVOCADOR_SA: 'i' };
  const recusa = (extra) => { try { criarFila({ ...base, ...extra }); return false; } catch (e) { return true; } };
  return (recusa({ TASKS_API: 'https://evil.example' }) && recusa({ METADADOS_URL: 'http://evil.example' })) || 'aceitou';
});

mostrar(casosLocais.splice(0));
await webhookSrv.fechar();
await worker.fechar();

await servidor.fechar();
await new Promise((ok) => falsos.close(ok));

console.log('\n' + '─'.repeat(64));
if (falhas) {
  console.log(`❌ ${falhas} caso(s) fora do esperado.\n`);
  process.exitCode = 1;
} else {
  console.log('✅ O runtime Node roda os .gs de produção de ponta a ponta.\n');
}
