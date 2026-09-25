#!/usr/bin/env node
/**
 * index.mjs — o servidor do runtime Node (BL-74, Fases 2 e 3).
 *
 *     node servidor/index.mjs
 *
 * O PAPEL (variável PAPEL). A MESMA imagem serve os três; no Cloud Run, os
 * dois da Fase 3 são DOIS serviços — porque o acesso público no Cloud Run é
 * por serviço, não por rota.
 *
 *   webhook  PÚBLICO. Confere a ASSINATURA da Meta (HMAC), enfileira no Cloud
 *            Tasks e responde em milissegundos. NÃO roda os `.gs`, NÃO tem os
 *            segredos do Odoo nem do WhatsApp — só o App Secret.
 *   worker   PRIVADO. Só o Cloud Tasks e o Cloud Scheduler chegam aqui, com
 *            token OIDC que o próprio Cloud Run verifica. Roda os `.gs`: uma
 *            mensagem por vez POR PESSOA (processador.mjs).
 *   local    um processo faz tudo, como o Apps Script: recebe, processa e só
 *            então responde. Para desenvolvimento e para a prova-runtime.
 *
 * AMBIENTE
 *   PORT / PORTA            porta HTTP (padrão 8080 — o do Cloud Run)
 *   webhook: META_APP_SECRET, VERIFY_TOKEN, FILA_PROJETO, FILA_REGIAO,
 *            FILA_NOME, WORKER_URL, INVOCADOR_SA
 *   worker/local: ARMAZENAMENTO (memoria|upstash), UPSTASH_REDIS_REST_URL/_TOKEN,
 *            PROCESSADORES, e as chaves de CHAVES_DE_CONFIG (plataforma/index.mjs)
 *   local:   CRON_TOKEN — o segredo do /cron (no worker, quem protege é o IAM)
 *   SÓ TESTE: PLATAFORMA_REDIRECIONAR, TASKS_API, METADADOS_URL — todos
 *            restritos a 127.0.0.1
 *
 * O FUSO não é variável: vem do `appsscript.json`, o mesmo que o Apps Script
 * usa. Todo `new Date().getMonth()` dos `.gs` depende dele (~33 lugares).
 */

import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { fusoDoProjeto } from './carregador.mjs';
import { criarFila } from './fila.mjs';

const LIMITE_CORPO = 1024 * 1024;
const PAPEIS = ['local', 'webhook', 'worker'];

/** O corpo como BYTES — a assinatura da Meta é sobre os bytes crus, não sobre um texto re-serializado. */
function lerBytes(req) {
  return new Promise((ok, falha) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > LIMITE_CORPO) { falha(Object.assign(new Error('corpo grande demais'), { codigo: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', falha);
  });
}
const lerCorpo = async (req) => (await lerBytes(req)).toString('utf8');

const iguais = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * A assinatura da Meta (BL-74, Fase 5). Todo POST de webhook traz
 * `X-Hub-Signature-256: sha256=<hex>`, o HMAC-SHA256 do corpo com o App Secret
 * do app. Só a Meta tem o segredo — e ele nunca viaja: diferente do `?token=`,
 * que ia na URL, aparecia nos logs de requisição e já tinha vazado uma vez.
 */
export function assinaturaValida(bytes, cabecalho, segredo) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(cabecalho || ''));
  if (!m || !segredo) return false;
  const esperado = createHmac('sha256', segredo).update(bytes).digest();
  const recebido = Buffer.from(m[1], 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/** Os processadores (worker threads) e a fila interna deles. */
async function subirProcessadores(env, armazenamento, quantos) {
  const redirecionar = env.PLATAFORMA_REDIRECIONAR ? JSON.parse(env.PLATAFORMA_REDIRECIONAR) : {};
  const fila = [];
  const pendentes = new Map();
  const processadores = [];
  let proximoId = 1;

  function despachar() {
    for (const p of processadores) {
      if (!p.livre || !fila.length) continue;
      const { pedido, cb } = fila.shift();
      p.livre = false;
      pendentes.set(pedido.id, cb);
      p.w.postMessage(pedido);
    }
  }

  await Promise.all(Array.from({ length: quantos }, () => new Promise((pronto, falha) => {
    const w = new Worker(new URL('./processador.mjs', import.meta.url),
      { workerData: { env, armazenamento, redirecionar } });
    const p = { w, livre: false };
    processadores.push(p);
    w.on('message', (m) => {
      if (m.pronto) { p.livre = true; pronto(p); despachar(); return; }
      const cb = pendentes.get(m.id);
      pendentes.delete(m.id);
      p.livre = true;
      if (cb) cb(m);
      despachar();
    });
    w.on('error', (e) => { console.error('💥 processador caiu:', e); falha(e); });
  })));

  return {
    executar: (pedido) => new Promise((ok) => { fila.push({ pedido: { ...pedido, id: proximoId++ }, cb: ok }); despachar(); }),
    tamanhoDaFila: () => fila.length,
    parar: () => Promise.all(processadores.map((p) => p.w.terminate())),
  };
}

/**
 * Sobe o servidor. Devolve { porta, fechar } — é assim que a prova-runtime o usa.
 */
export async function iniciar(opcoes = {}) {
  const env = { ...process.env, ...(opcoes.env || {}) };
  const papel = env.PAPEL || 'local';
  if (!PAPEIS.includes(papel)) throw new Error(`PAPEL=${papel} desconhecido. Use ${PAPEIS.join(', ')}.`);

  // Antes de qualquer worker nascer: elas herdam o fuso do processo.
  process.env.TZ = fusoDoProjeto();

  // ── O que cada papel precisa ────────────────────────────────────────────
  let processadores = null;
  let fila = null;
  const armazenamento = env.ARMAZENAMENTO || 'memoria';
  const quantos = Number(env.PROCESSADORES || 1);

  if (papel === 'webhook') {
    // Sem o App Secret, toda assinatura seria recusada — melhor não subir do
    // que subir recusando mensagem.
    if (!env.META_APP_SECRET) throw new Error('PAPEL=webhook exige META_APP_SECRET.');
    fila = criarFila(env);
  } else {
    if (armazenamento === 'memoria' && quantos !== 1) {
      // Cada processador teria a sua memória: o cache de um não existiria para
      // o outro, e a trava não travaria nada.
      throw new Error('ARMAZENAMENTO=memoria exige PROCESSADORES=1. Para mais, use upstash.');
    }
    if (papel === 'worker' && armazenamento === 'memoria') {
      // No Cloud Run o worker escala para várias instâncias: memória não é
      // compartilhada, e a trava por pessoa não travaria nada entre elas.
      throw new Error('PAPEL=worker exige ARMAZENAMENTO=upstash.');
    }
    processadores = await subirProcessadores(env, armazenamento, quantos);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  const texto = (res, codigo, corpo) => {
    res.writeHead(codigo, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(corpo);
  };

  async function webhook(req, res, url, parameter) {
    if (req.method === 'GET') {
      // A verificação da Meta, sem precisar dos `.gs` — é o mesmo teste do doGet.
      const ok = parameter['hub.mode'] === 'subscribe' && env.VERIFY_TOKEN &&
                 iguais(parameter['hub.verify_token'] || '', env.VERIFY_TOKEN);
      texto(res, 200, ok ? String(parameter['hub.challenge'] || '') : 'Forbidden');
      return;
    }
    const bytes = await lerBytes(req);
    // Fase 5: só vale a ASSINATURA. O `?token=` da URL não é mais aceito aqui.
    //
    // 401, e não o 200 "Forbidden" do Apps Script — de propósito. A Meta
    // REENVIA o que não recebe com 200. Se o App Secret estiver errado no dia do
    // corte, nenhuma mensagem se perde: ela volta quando o segredo for corrigido.
    // Uma requisição forjada leva o mesmo 401, e não custa nada.
    if (!assinaturaValida(bytes, req.headers['x-hub-signature-256'], env.META_APP_SECRET)) {
      console.warn(`🚫 POST recusado: assinatura ${req.headers['x-hub-signature-256'] ? 'inválida' : 'ausente'}`);
      texto(res, 401, 'Unauthorized');
      return;
    }
    try {
      const r = await fila.enfileirar(bytes.toString('utf8'));
      if (r === 'repetida') console.log('♻️ reentrega da Meta — a fila recusou a tarefa repetida');
      texto(res, 200, 'OK');
    } catch (e) {
      // AQUI o 500 é de propósito, e é uma melhoria sobre o Apps Script: a
      // Meta REENVIA o que recebe com erro. Sem fila, a mensagem se perderia;
      // devolvendo 500, ela volta daqui a pouco.
      console.error('💥 não enfileirei:', e.message);
      texto(res, 500, 'Error');
    }
  }

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      const parameter = Object.fromEntries(url.searchParams);

      if (req.method === 'GET' && url.pathname === '/saude') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, papel,
          armazenamento: papel === 'webhook' ? null : armazenamento,
          processadores: papel === 'webhook' ? 0 : quantos,
          fuso: process.env.TZ, fila: processadores ? processadores.tamanhoDaFila() : 0 }));
        return;
      }

      // ── webhook: autentica, enfileira, responde ──────────────────────────
      if (papel === 'webhook') {
        if (url.pathname === '/webhook' && (req.method === 'GET' || req.method === 'POST')) {
          await webhook(req, res, url, parameter);
          return;
        }
        texto(res, 404, 'Not found');
        return;
      }

      // ── worker: o que a fila entrega ─────────────────────────────────────
      if (papel === 'worker' && url.pathname === '/processar' && req.method === 'POST') {
        const corpo = await lerCorpo(req);
        const r = await processadores.executar({ tipo: 'doPostFila', corpo });
        // 503 = outra mensagem da mesma pessoa está em processamento. O Cloud
        // Tasks tenta de novo com espera crescente — é a fila fazendo a vez.
        if (r.ok && r.ocupado) { texto(res, 503, 'ocupado'); return; }
        texto(res, r.ok ? 200 : 500, r.ok ? 'OK' : 'Error');
        return;
      }

      // ── local: como o Apps Script ────────────────────────────────────────
      if (papel === 'local' && url.pathname === '/webhook' && (req.method === 'GET' || req.method === 'POST')) {
        const contents = req.method === 'POST' ? await lerCorpo(req) : '';
        const evento = { parameter, queryString: url.search.slice(1),
                         postData: req.method === 'POST' ? { contents, type: req.headers['content-type'] || '' } : undefined };
        const r = await processadores.executar({ tipo: req.method === 'GET' ? 'doGet' : 'doPost', evento });
        texto(res, 200, r.ok ? r.texto : 'Error');
        return;
      }

      // ── agendamentos (worker e local) ────────────────────────────────────
      const cron = url.pathname.match(/^\/cron\/([A-Za-z]+)$/);
      if (cron && req.method === 'POST') {
        // No worker, quem protege é o IAM do Cloud Run (serviço privado, só o
        // Cloud Scheduler com token OIDC). No local, não há IAM: segredo.
        if (papel === 'local' && (!env.CRON_TOKEN || !iguais(req.headers['x-cron-token'] || '', env.CRON_TOKEN))) {
          texto(res, 403, 'Forbidden');
          return;
        }
        const r = await processadores.executar({ tipo: 'funcao', nome: cron[1] });
        texto(res, r.ok ? 200 : 500, r.ok ? 'OK' : r.erro);
        return;
      }

      texto(res, 404, 'Not found');
    } catch (e) {
      texto(res, e.codigo || 500, e.codigo ? e.message : 'Error');
      if (!e.codigo) console.error('💥 [servidor]', e);
    }
  });

  const porta = Number(opcoes.porta ?? env.PORT ?? env.PORTA ?? 8080);
  await new Promise((ok) => servidor.listen(porta, ok));
  const real = servidor.address().port;
  console.log(`🚀 runtime Node: papel=${papel}` +
              (papel === 'webhook' ? '' : ` armazenamento=${armazenamento} processadores=${quantos}`) +
              ` fuso=${process.env.TZ} porta=${real}`);

  return {
    porta: real,
    fechar: async () => {
      await new Promise((ok) => servidor.close(ok));
      if (processadores) await processadores.parar();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  iniciar().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
