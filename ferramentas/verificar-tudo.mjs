#!/usr/bin/env node
/**
 * verificar-tudo.mjs — tudo que dá para conferir sem tocar em produção.
 *
 * POR QUE UM PONTO DE ENTRADA SÓ (BL-74, Fase 0)
 *   O CI e a sua máquina precisam rodar EXATAMENTE a mesma coisa. Se o
 *   workflow listar os comandos por conta própria, os dois divergem no
 *   primeiro dia em que alguém acrescenta uma suíte — e a divergência aparece
 *   como "passa aqui, quebra lá", que é o jeito mais caro de descobrir.
 *
 *   Aqui a lista é uma só. O workflow chama este arquivo e nada mais.
 *
 * NENHUMA SUÍTE TOCA NO ODOO, NO WHATSAPP OU NO APPS SCRIPT. Não há
 * credencial envolvida, e nada aqui altera estado em lugar nenhum.
 *
 *     node ferramentas/verificar-tudo.mjs
 *
 * Sai 1 se qualquer suíte reprovar.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUITES = [
  { arquivo: 'ferramentas/conta-mensagens.js',
    nome: 'O contrato: mensagens, fluxos, views e guardas',
    rede: false },
  { arquivo: 'ferramentas/prova-verificador.mjs',
    nome: 'O verificador de permissões contra um Odoo de mentira',
    rede: false },
  { arquivo: 'ferramentas/valida-flow.js',
    nome: 'Os Flows do WhatsApp contra as regras da Meta',
    rede: false },
  // Esta baixa o py_js do Odoo para EXECUTAR os domínios das views. É a única
  // que depende de rede, e por isso a falha dela é rotulada à parte: um
  // GitHub fora do ar não pode ser lido como código quebrado.
  { arquivo: 'ferramentas/provar-dominio-filtro.mjs',
    nome: 'Os domínios das views avaliados pelo py_js real',
    rede: true },
];

const rodar = (arquivo) => new Promise((ok) => {
  const t0 = Date.now();
  execFile('node', [arquivo], { cwd: RAIZ, maxBuffer: 32 * 1024 * 1024 },
    (erro, saida, err) => ok({
      code: erro ? (erro.code ?? 1) : 0,
      txt: saida + err,
      seg: ((Date.now() - t0) / 1000).toFixed(1),
    }));
});

console.log('\n🔍 Verificação completa — nada toca em produção\n');

const falharam = [];
for (const s of SUITES) {
  const r = await rodar(s.arquivo);
  const ok = r.code === 0;
  if (!ok) falharam.push({ ...s, ...r });
  console.log(`${ok ? '✅' : '❌'} ${s.nome}`);
  console.log(`   ${s.arquivo}${s.rede ? '  [usa rede]' : ''} — ${r.seg}s`);
}

console.log('\n' + '─'.repeat(64));

if (!falharam.length) {
  console.log(`✅ ${SUITES.length} suítes, todas verdes.\n`);
  process.exit(0);
}

// A saída de quem reprovou, inteira. Um resumo que esconde o erro obriga a
// rodar de novo à mão para ver o que houve — e aí o CI serviu de aviso, não
// de diagnóstico.
for (const f of falharam) {
  console.log(`\n❌ ${f.nome}`);
  console.log(`   ${f.arquivo} saiu com ${f.code}\n`);
  console.log(f.txt.trimEnd().split('\n').map((l) => '   │ ' + l).join('\n'));
}

console.log('\n' + '─'.repeat(64));
console.log(`❌ ${falharam.length} de ${SUITES.length} suíte(s) reprovaram.`);

if (falharam.every((f) => f.rede)) {
  console.log('   ⚠️  Só suíte que usa REDE falhou. Antes de procurar bug no código,');
  console.log('      confira se o GitHub respondeu — esta baixa o py_js de lá.');
}
console.log('');
process.exit(1);
