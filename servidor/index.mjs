#!/usr/bin/env node
/**
 * index.mjs — o servidor do runtime Node (BL-74, Fase 2).
 *
 *     node servidor/index.mjs
 *
 * O PAPEL (variável PAPEL):
 *   local    um processo faz tudo — recebe o webhook, processa na hora e só
 *            então responde, como o Apps Script faz hoje. É o da Fase 2.
 *   webhook  (Fase 3) valida, enfileira no Cloud Tasks e responde na hora.
 *   worker   (Fase 3) consome a fila e roda os agendamentos — serviço privado.
 * Os dois da Fase 3 recusam subir: sem a fila, um webhook que "enfileira" perderia
 * mensagens em silêncio.
 *
 * AMBIENTE
 *   PORT / PORTA            porta HTTP (padrão 8080 — o do Cloud Run)
 *   ARMAZENAMENTO           memoria (padrão) | upstash
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   PROCESSADORES           worker threads (padrão 1; memoria exige 1)
 *   CRON_TOKEN              segredo do /cron/<função> no modo local
 *   WHATSAPP_TOKEN, ODOO_*, … as chaves de CHAVES_DE_CONFIG (plataforma/index.mjs)
 *   PLATAFORMA_REDIRECIONAR SÓ TESTE: JSON { "https://origem": "http://127.0.0.1:porta" }
 *
 * O FUSO não é variável: vem do `appsscript.json`, o mesmo que o Apps Script
 * usa. Todo `new Date().getMonth()` dos `.gs` depende dele (~33 lugares).
 */

import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { fusoDoProjeto } from './carregador.mjs';

const LIMITE_CORPO = 1024 * 1024;

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > LIMITE_CORPO) { falha(Object.assign(new Error('corpo grande demais'), { codigo: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

const iguais = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Sobe o servidor. Devolve { porta, fechar } — é assim que a prova-runtime o usa.
 */
export async function iniciar(opcoes = {}) {
  const env = { ...process.env, ...(opcoes.env || {}) };
  const papel = env.PAPEL || 'local';
  if (papel !== 'local') {
    throw new Error(`PAPEL=${papel} é da Fase 3 (precisa do Cloud Tasks). Use PAPEL=local.`);
  }

  const armazenamento = env.ARMAZENAMENTO || 'memoria';
  const quantos = Number(env.PROCESSADORES || 1);
  if (armazenamento === 'memoria' && quantos !== 1) {
    // Cada processador teria a sua memória: o cache de um não existiria para o
    // outro, e a trava não travaria nada.
    throw new Error('ARMAZENAMENTO=memoria exige PROCESSADORES=1. Para mais, use upstash.');
  }

  // Antes de qualquer worker nascer: elas herdam o fuso do processo.
  process.env.TZ = fusoDoProjeto();

  const redirecionar = env.PLATAFORMA_REDIRECIONAR ? JSON.parse(env.PLATAFORMA_REDIRECIONAR) : {};

  // ── Processadores e fila ────────────────────────────────────────────────
  const fila = [];
  const pendentes = new Map();
  let proximoId = 1;
  const processadores = [];
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

  function despachar() {
    for (const p of processadores) {
      if (!p.livre || !fila.length) continue;
      const { pedido, cb } = fila.shift();
      p.livre = false;
      pendentes.set(pedido.id, cb);
      p.w.postMessage(pedido);
    }
  }
  const executar = (pedido) => new Promise((ok) => {
    fila.push({ pedido: { ...pedido, id: proximoId++ }, cb: ok });
    despachar();
  });

  // ── HTTP ────────────────────────────────────────────────────────────────
  const texto = (res, codigo, corpo) => {
    res.writeHead(codigo, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(corpo);
  };

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      const parameter = Object.fromEntries(url.searchParams);

      if (req.method === 'GET' && url.pathname === '/saude') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, papel, armazenamento, processadores: quantos,
                                 fuso: process.env.TZ, fila: fila.length }));
        return;
      }

      if (url.pathname === '/webhook' && (req.method === 'GET' || req.method === 'POST')) {
        const contents = req.method === 'POST' ? await lerCorpo(req) : '';
        const evento = { parameter, queryString: url.search.slice(1),
                         postData: req.method === 'POST' ? { contents, type: req.headers['content-type'] || '' } : undefined };
        const r = await executar({ tipo: req.method === 'GET' ? 'doGet' : 'doPost', evento });
        // Como o Apps Script: sempre 200 (ver Plataforma.gs, "resposta").
        texto(res, 200, r.ok ? r.texto : 'Error');
        return;
      }

      const cron = url.pathname.match(/^\/cron\/([A-Za-z]+)$/);
      if (cron && req.method === 'POST') {
        // Modo local: segredo compartilhado. Na Fase 4 vira OIDC do Cloud
        // Scheduler, num serviço que nem é público.
        if (!env.CRON_TOKEN || !iguais(req.headers['x-cron-token'] || '', env.CRON_TOKEN)) {
          texto(res, 403, 'Forbidden');
          return;
        }
        const r = await executar({ tipo: 'funcao', nome: cron[1] });
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
  console.log(`🚀 runtime Node: papel=${papel} armazenamento=${armazenamento} ` +
              `processadores=${quantos} fuso=${process.env.TZ} porta=${real}`);

  return {
    porta: real,
    fechar: async () => {
      await new Promise((ok) => servidor.close(ok));
      await Promise.all(processadores.map((p) => p.w.terminate()));
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  iniciar().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
