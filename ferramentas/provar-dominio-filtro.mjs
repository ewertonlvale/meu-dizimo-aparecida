/**
 * provar-dominio-filtro.mjs — Executa os domínios dos filtros de busca no
 * MESMO avaliador que o navegador usa.
 *
 * POR QUE ISTO EXISTE
 *   Domínio de filtro de busca não passa pelo Python do servidor. Quem avalia
 *   é o py_js — um Python parcial, escrito em JavaScript, que vive dentro do
 *   web client do Odoo. Ele implementa bem menos coisa do que parece, e o que
 *   ele não implementa não avisa: o filtro simplesmente não filtra.
 *
 *   Foi assim que o "Mês Atual" de x_devolucao passou meses sem nunca devolver
 *   nada. Estava escrito `context_today().replace(day=1)`, e o PyDate do py_js
 *   tem today, strftime, add, substract e toordinal — `replace` não. A
 *   expressão estourava em toda data, calada, dentro do navegador.
 *
 *   Ler a fonte do py_js responde "existe ou não existe". Só executar responde
 *   "dá o resultado certo em 29/02 e na virada de dezembro". Este script
 *   executa.
 *
 * ⚠️ ELE NÃO CONCORDA COM O DATEUTIL DE VERDADE, E ESSA É A GRAÇA
 *   A forma canônica do próprio Odoo para "mês atual" é
 *   `relativedelta(day=1)` … `relativedelta(day=31)` com `<=`. No dateutil o
 *   `day=31` é limitado ao último dia do mês; no py_js ele transborda. Em
 *   fevereiro de 2026 o limite superior vira 03/03 e o "mês atual" arrasta
 *   três dias de março. Rode com --canonico para ver.
 *
 * COMO RODAR
 *     node ferramentas/provar-dominio-filtro.mjs
 *     node ferramentas/provar-dominio-filtro.mjs --canonico
 *
 *   Precisa de rede na primeira vez: baixa o py_js da tag do Odoo fixada em
 *   TAG_ODOO e guarda em ferramentas/.cache-pyjs (ignorado pelo git). Nas
 *   vezes seguintes roda offline.
 *
 *   Nada daqui fala com a instância. É leitura de arquivo e aritmética.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VIEWS = join(AQUI, 'views-odoo');
const CACHE = join(AQUI, '.cache-pyjs');

// Fixa na versão da instância. Trocar de versão do Odoo é trocar de avaliador,
// e a prova precisa ser feita contra o avaliador que vai rodar de verdade.
const TAG_ODOO = 'saas-19.3';
const BASE = `https://raw.githubusercontent.com/odoo/odoo/${TAG_ODOO}/addons/web/static/src/core/py_js`;
const MODULOS = ['py.js', 'py_builtin.js', 'py_date.js', 'py_interpreter.js',
                 'py_parser.js', 'py_tokenizer.js', 'py_utils.js'];

const argv = process.argv.slice(2);
{
  const CONHECIDOS = new Set(['--canonico']);
  const estranhos = argv.filter((a) => a.startsWith('--') && !CONHECIDOS.has(a));
  if (estranhos.length) {
    console.error(`❌ Não conheço: ${estranhos.join(', ')}`);
    console.error(`   Conhecidos: ${[...CONHECIDOS].join(' ')}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// O avaliador
// ---------------------------------------------------------------------------

async function garantirPyJs() {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  // O .gitignore vem antes do download, e não depois: se a rede cair no meio,
  // o que já baixou não pode aparecer no `git status` pedindo commit.
  writeFileSync(join(CACHE, '.gitignore'), '*\n');
  // package.json com type:module: os arquivos do Odoo são ESM.
  writeFileSync(join(CACHE, 'package.json'), '{"type":"module"}\n');

  const faltando = MODULOS.filter((m) => !existsSync(join(CACHE, m)));
  if (!faltando.length) return;

  console.log(`⬇️  baixando py_js do Odoo ${TAG_ODOO} (uma vez só)…`);
  for (const m of faltando) {
    let res;
    try {
      res = await fetch(`${BASE}/${m}`);
    } catch (e) {
      const causa = e.cause?.code || e.cause?.message || e.message;
      console.error(`❌ não consegui baixar ${m} (${causa})`);
      console.error('   Isso é rede. Nada foi verificado — não tire conclusão daqui.');
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`❌ ${m} voltou HTTP ${res.status}. A tag ${TAG_ODOO} ainda existe?`);
      process.exit(1);
    }
    // Os imports do Odoo vêm sem extensão ("./py_date"); o ESM do Node exige.
    const txt = (await res.text()).replace(/(from "\.\/[a-z_]+)"/g, '$1.js"');
    writeFileSync(join(CACHE, m), txt);
  }
}

await garantirPyJs();
const { evaluateExpr } = await import(join(CACHE, 'py.js'));

// `context_today()` chama `new Date()`. Para provar a virada de ano e o 29/02
// é preciso mandar no relógio.
const DateReal = Date;
function comHoje(iso, fn) {
  const [y, m, d] = iso.split('-').map(Number);
  globalThis.Date = class extends DateReal {
    constructor(...a) { if (a.length === 0) super(y, m - 1, d); else super(...a); }
  };
  try { return fn(); } finally { globalThis.Date = DateReal; }
}

// Datas escolhidas pelas bordas, não por acaso: último dia de mês de 30 e de
// 31, virada de ano, fevereiro comum e bissexto.
const DATAS = ['2026-09-21', '2026-01-31', '2026-02-01', '2026-02-28', '2024-02-29',
               '2026-04-15', '2026-04-30', '2026-06-30', '2026-11-30', '2026-12-01',
               '2026-12-31'];

function primeiroDia(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
function primeiroDiaSeguinte(iso) {
  let [y, m] = iso.split('-').map(Number);
  if (++m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

let falhas = 0;

// ---------------------------------------------------------------------------
// 1. Todo domínio versionado precisa pelo menos AVALIAR
// ---------------------------------------------------------------------------

console.log(`\n🗓️  py_js do Odoo ${TAG_ODOO}\n`);
console.log('── Todos os domínios das views versionadas avaliam?\n');

const arquivos = readdirSync(VIEWS).filter((f) => f.endsWith('.xml') && !f.includes('.COMBINADA.'));
let total = 0;
for (const f of arquivos) {
  const xml = readFileSync(join(VIEWS, f), 'utf8');
  for (const m of xml.matchAll(/\bdomain\s*=\s*"([^"]*)"/g)) {
    const expr = m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    total++;
    // Uma data por domínio basta aqui; o que interessa é "estoura ou não".
    const erro = comHoje('2026-02-28', () => {
      try { evaluateExpr(expr); return null; } catch (e) { return e.message.split('\n')[0]; }
    });
    if (erro) {
      falhas++;
      console.log(`❌ ${f}`);
      console.log(`   ${expr.replace(/\s+/g, ' ').slice(0, 110)}`);
      console.log(`   ${erro}`);
    }
  }
}
if (!falhas) console.log(`✅ ${total} domínios em ${arquivos.length} views, todos avaliam`);

// ---------------------------------------------------------------------------
// 2. O "Mês Atual" precisa dar o mês certo, não só avaliar
// ---------------------------------------------------------------------------

console.log('\n── "Mês Atual" devolve mesmo o mês, em toda borda?\n');

const CANONICO = `[('d','>=',(context_today()+relativedelta(day=1)).strftime('%Y-%m-%d')),('d','<=',(context_today()+relativedelta(day=31)).strftime('%Y-%m-%d'))]`;

// Extraído da view de verdade, não copiado: se alguém mudar o filtro lá, é o
// filtro novo que passa a ser provado aqui. A busca varre TODAS as views, e
// não a primeira que casa com o nome do modelo — a primeira é a view base, que
// não tem filtro nenhum, e procurar só nela dava "não achei" com o filtro
// presente duas linhas ao lado.
let EM_USO = null;
let ondeAchei = null;
for (const f of arquivos) {
  const tag = readFileSync(join(VIEWS, f), 'utf8')
    .match(/<filter\b[^>]*string="Mês Atual"[^>]*>/s);
  const dom = tag?.[0].match(/\bdomain="([^"]*)"/s);
  if (dom) {
    EM_USO = dom[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    ondeAchei = f;
    break;
  }
}
if (!EM_USO) {
  falhas++;
  console.log('❌ não achei nenhum filtro "Mês Atual" nas views versionadas — foi renomeado?');
}

const aProvar = [];
if (EM_USO) aProvar.push([`em uso (${ondeAchei.split('.').slice(0, 3).join('.')})`, EM_USO, true]);
if (argv.includes('--canonico')) aProvar.push(['canônico do Odoo (day=1 / day=31)', CANONICO, false]);

for (const [nome, expr, deveAcertar] of aProvar) {
  console.log(`   ${nome}`);
  for (const dia of DATAS) {
    const r = comHoje(dia, () => {
      try { return evaluateExpr(expr); } catch (e) { return e; }
    });
    if (r instanceof Error) {
      if (deveAcertar) falhas++;
      console.log(`   ${deveAcertar ? '❌' : '  '} ${dia} → 💥 ${r.message.split('\n')[0]}`);
      continue;
    }
    const [[, opDe, de], [, opAte, ate]] = r;
    // O mês vai do dia 1 ao dia 1 do mês seguinte, com o limite superior
    // ABERTO. Qualquer outra coisa ou perde o último dia ou invade o mês que vem.
    const ok = opDe === '>=' && de === primeiroDia(dia)
            && opAte === '<' && ate === primeiroDiaSeguinte(dia);
    if (!ok && deveAcertar) falhas++;
    const marca = ok ? '✅' : (deveAcertar ? '❌' : '⚠️ ');
    console.log(`   ${marca} ${dia} → ${opDe} ${de}  ${opAte} ${ate}`
      + (ok ? '' : `   (esperado >= ${primeiroDia(dia)} e < ${primeiroDiaSeguinte(dia)})`));
  }
  console.log('');
}

if (!argv.includes('--canonico')) {
  console.log('   (--canonico mostra por que a forma day=31, que o próprio Odoo usa,');
  console.log('    não serve: no py_js ela transborda em mês de menos de 31 dias.)\n');
}

console.log('─'.repeat(64));
if (falhas) {
  console.log(`❌ ${falhas} problema(s). O filtro não vai fazer no navegador o que diz fazer.\n`);
  process.exit(1);
}
console.log('✅ Todo domínio avalia, e o "Mês Atual" fecha o mês em toda borda.\n');
