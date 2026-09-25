#!/usr/bin/env node
/**
 * importar-propriedades.mjs — leva as propriedades do Apps Script ao Upstash (BL-74, Fase 5).
 *
 * No corte, o runtime novo precisa do que o Apps Script GRAVOU e o código lê:
 * as chaves ligadas/desligadas (FLOW_CADASTRO_ATIVO…), as sessões de cadastro
 * em andamento, os bloqueios, os contadores do mês. Sem isto, o Cloud Run sobe
 * com os valores padrão — que podem não ser os de hoje.
 *
 * DE ONDE VEM O JSON: da função `exportarPropriedadesParaMigracao()` do
 * Apps Script (Setup.gs), rodada no editor NO MOMENTO DO CORTE.
 *
 *     node ferramentas/importar-propriedades.mjs propriedades.json            (simula)
 *     node ferramentas/importar-propriedades.mjs propriedades.json --aplicar
 *
 * Ambiente: UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN.
 *
 * SIMULA POR PADRÃO: mostra o que entra, o que muda e o que fica igual, e não
 * grava nada. Recusa, sem gravar, um JSON que traga segredo ou o
 * NOTIFICACOES_ATIVAS — a exportação já os deixa de fora; aparecer aqui quer
 * dizer que o arquivo não veio de lá.
 */

import fs from 'node:fs';

// IGUAL a PROPRIEDADES_NAO_MIGRAR do Setup.gs — o conta-mensagens.js confere.
export const NAO_MIGRAR = [
  'WHATSAPP_TOKEN', 'ODOO_API_KEY', 'GOOGLE_VISION_API_KEY', 'WEBHOOK_SECRET', 'WHATSAPP_PIN',
  'VERIFY_TOKEN', 'WHATSAPP_PHONE_ID', 'ODOO_URL', 'ODOO_DATABASE', 'ODOO_UID',
  'NOTIFICACOES_ATIVAS',
];

const sair = (codigo, msg) => { if (msg) console.error(msg); process.exitCode = codigo; };

async function principal() {
  const args = process.argv.slice(2);
  const arquivo = args.find((a) => !a.startsWith('--'));
  const aplicar = args.includes('--aplicar');
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';

  if (!arquivo) return sair(1, '❌ Diga o arquivo: node ferramentas/importar-propriedades.mjs propriedades.json [--aplicar]');
  if (!url || !token) return sair(1, '❌ Faltam UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no ambiente.');

  let novas;
  try {
    novas = JSON.parse(fs.readFileSync(arquivo, 'utf8').trim());
  } catch (e) {
    return sair(1, `❌ ${arquivo} não é o JSON da exportação: ${e.message}\n` +
      '   Copie do log do Apps Script a linha que começa com { e termina com }.');
  }
  if (!novas || typeof novas !== 'object' || Array.isArray(novas)) return sair(1, '❌ O JSON tem de ser um objeto { chave: valor }.');

  const proibidas = Object.keys(novas).filter((k) => NAO_MIGRAR.includes(k));
  if (proibidas.length) {
    return sair(1, `❌ O arquivo traz ${proibidas.join(', ')} — segredo, configuração ou a chave dos lembretes.\n` +
      '   A exportação do Apps Script os deixa de fora; este arquivo não veio de lá. Nada foi gravado.');
  }

  const comando = async (...cmd) => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(cmd.map(String)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Upstash ${cmd[0]}: ${j.error || 'HTTP ' + r.status}`);
    return j.result;
  };

  // O que já está lá — HGETALL devolve [chave, valor, chave, valor, …].
  const plano = await comando('HGETALL', 'p') || [];
  const atuais = {};
  for (let i = 0; i < plano.length; i += 2) atuais[plano[i]] = plano[i + 1];

  const entram = [], mudam = [], iguais = [];
  for (const [k, v] of Object.entries(novas)) {
    const valor = String(v);
    if (!(k in atuais)) entram.push(k);
    else if (atuais[k] !== valor) mudam.push(k);
    else iguais.push(k);
  }

  console.log(`\n📦 ${Object.keys(novas).length} propriedade(s) no arquivo`);
  console.log(`   entram: ${entram.length}${entram.length ? '  (' + entram.join(', ') + ')' : ''}`);
  console.log(`   mudam:  ${mudam.length}${mudam.length ? '  (' + mudam.map((k) => `${k}: "${atuais[k]}" → "${novas[k]}"`).join(', ') + ')' : ''}`);
  console.log(`   iguais: ${iguais.length}`);

  if (!aplicar) {
    console.log('\n👀 Simulação — nada foi gravado. Repita com --aplicar.\n');
    return sair(0);
  }
  if (!entram.length && !mudam.length) {
    console.log('\n✅ Nada a gravar: o Upstash já tem tudo igual.\n');
    return sair(0);
  }

  const pares = [...entram, ...mudam].flatMap((k) => [k, String(novas[k])]);
  await comando('HSET', 'p', ...pares);

  // Confere lendo de volta — "gravei" sem conferir é promessa.
  const depois = await comando('HGETALL', 'p') || [];
  const conferido = {};
  for (let i = 0; i < depois.length; i += 2) conferido[depois[i]] = depois[i + 1];
  const faltando = [...entram, ...mudam].filter((k) => conferido[k] !== String(novas[k]));
  if (faltando.length) return sair(1, `❌ Gravei, mas ao ler de volta não batem: ${faltando.join(', ')}`);

  console.log(`\n✅ ${entram.length + mudam.length} propriedade(s) gravada(s) e conferida(s) no Upstash.\n`);
  return sair(0);
}

principal().catch((e) => sair(1, `❌ ${e.message}`));
