/**
 * baixar-views.mjs — Leva e traz as views de um tipo (padrão: kanban) do Odoo.
 *
 * POR QUE EXISTE
 *   Ler o arch pela tela do Studio dá uma linha só, sem indentação, e obriga a
 *   copiar à mão modelo por modelo. Pior: para modelos do core (res.users) o
 *   que aparece ali é a view BASE ou um diff de herança — nunca o resultado
 *   final que o usuário vê. Este script baixa as duas coisas, separadas:
 *
 *     1. As views cruas (`ir.ui.view`), inclusive as herdadas, uma por arquivo
 *     2. A view COMBINADA, que é o Odoo aplicando as heranças em cima da base
 *
 *   Para x_dizimista e x_devolucao, que são modelos do Studio sem herança, as
 *   duas costumam coincidir. Para res.users, não: é ali que a diferença conta.
 *
 * COMO RODAR (Node 18+, usa fetch nativo — nada para instalar)
 *
 *   1. Uma vez só, crie o arquivo de credenciais:
 *        cp ferramentas/.odoo-env.exemplo ferramentas/.odoo-env
 *      e preencha ODOO_URL, ODOO_DB, ODOO_UID e ODOO_API_KEY.
 *      Esse arquivo está no .gitignore. Como restringir o acesso a ele em
 *      cada sistema está comentado dentro do próprio .exemplo — `chmod` não
 *      existe no PowerShell.
 *
 *   2. Depois:
 *        node ferramentas/baixar-views.mjs --download   (padrão; --download é opcional)
 *        node ferramentas/baixar-views.mjs --update     (sobe os arquivos de volta)
 *
 *   ANTES DE UM --update PARA VALER, veja o que mudaria:
 *        node ferramentas/baixar-views.mjs --update --simular
 *
 *   Sem o arquivo, tudo continua funcionando por ambiente/argumento:
 *     bash:        ODOO_API_KEY=... node ferramentas/baixar-views.mjs \
 *                    --url https://sua-instancia.odoo.com --db seu_db --uid 2
 *     PowerShell:  $env:ODOO_API_KEY = "sua-chave"
 *                  node ferramentas/baixar-views.mjs --url https://... --db x --uid 2
 *
 *   Opcionais:
 *     --modelos x_dizimista,x_devolucao,res.users   (este é o padrão)
 *     --tipo    kanban                              (list, form, search…)
 *     --saida   ferramentas/views-odoo              (pasta de trabalho)
 *     --simular  no --update, mostra o que mudaria e não grava nada
 *     --forcar   no --update, sobe mesmo se a view mudou no Odoo desde o download
 *
 * ───────────────────────────────────────────────────────────────────────
 * O QUE O --update NÃO FAZ
 *
 * Não cria view, não apaga view, não desativa view. Só reescreve o arch de
 * views que o indice.json já conhece. Criar e remover tela continua sendo
 * decisão de quem abre o Studio.
 *
 * E não sobe .COMBINADA.xml — aquilo é o resultado das heranças, não um
 * registro. Gravá-lo na view base duplicaria o que a herança acrescenta.
 * ───────────────────────────────────────────────────────────────────────
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEGURANÇA — a mesma postura do odoo-dump.mjs, e pelas mesmas razões
 *
 * Este arquivo é versionado num repositório PÚBLICO. Nada vem preenchido: url,
 * db e uid não são segredo isolados, mas juntos transformam um alvo anônimo num
 * alvo nomeado. O script recusa rodar sem os três.
 *
 * A API KEY só entra por VARIÁVEL DE AMBIENTE. Argumento de linha de comando
 * fica no histórico do shell e aparece na lista de processos da máquina.
 *
 * A pasta de saída nasce com um .gitignore próprio. Os archs não são segredo,
 * mas também não precisam ir para um repositório público sem alguém decidir
 * isso — e o padrão seguro é o que não exige lembrar.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { carregarEnv } from './odoo-env.mjs';

// Credenciais de ferramentas/.odoo-env, quando existir. Variável de ambiente
// real tem precedência sobre o arquivo — ver odoo-env.mjs.
const env = carregarEnv(process.env.ODOO_ENV_FILE || 'ferramentas/.odoo-env');
if (env?.carregadas.length) {
  console.log(`🔑 ${env.caminho}: ${env.carregadas.join(', ')}`);
}
if (env?.vazias.length) {
  console.log(`⚠️  ${env.caminho}: em branco → ${env.vazias.join(', ')}`);
}

const argv = process.argv.slice(2);
const arg = (nome) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};

const CONFIG = {
  url: (arg('url') || process.env.ODOO_URL || '').replace(/\/+$/, ''),
  db:   arg('db')  || process.env.ODOO_DB  || '',
  uid:  Number(arg('uid') || process.env.ODOO_UID || 0),
  // Só env — ver a nota de segurança no topo.
  apiKey: process.env.ODOO_API_KEY || '',
  // --download é o padrão. --update sobe de volta o que está nos arquivos.
  modo: argv.includes('--update') ? 'update' : 'download',
  // --simular mostra o que mudaria sem gravar nada. --forcar passa por cima
  // da trava de divergência (ver MODO UPDATE).
  simular: argv.includes('--simular') || argv.includes('--dry-run'),
  forcar:  argv.includes('--forcar'),
  tipo:  arg('tipo')  || 'kanban',
  saida: arg('saida') || 'ferramentas/views-odoo',
  modelos: (arg('modelos') || 'x_dizimista,x_devolucao,res.users')
    .split(',').map((m) => m.trim()).filter(Boolean),
};

const faltando = [];
if (!CONFIG.url)    faltando.push('--url (ou ODOO_URL)');
if (!CONFIG.db)     faltando.push('--db (ou ODOO_DB)');
if (!CONFIG.uid)    faltando.push('--uid (ou ODOO_UID)');
if (!CONFIG.apiKey) faltando.push('ODOO_API_KEY (variável de ambiente)');

if (faltando.length) {
  console.error('❌ Faltou:\n   ' + faltando.join('\n   '));
  console.error('\nO jeito mais simples é o arquivo de credenciais:');
  console.error('   cp ferramentas/.odoo-env.exemplo ferramentas/.odoo-env');
  // `chmod` não existe no PowerShell, e sugeri-lo ali só produz um erro
  // vermelho que assusta sem motivo — a cópia já funcionou.
  console.error(process.platform === 'win32'
    ? '   icacls ferramentas\\.odoo-env /inheritance:r /grant:r "$($env:USERNAME):(R,W)"   # opcional'
    : '   chmod 600 ferramentas/.odoo-env');
  console.error('   (preencha os quatro valores — o arquivo está no .gitignore)');
  console.error('\nOu, sem arquivo:');
  console.error('   ODOO_API_KEY=sua-chave node ferramentas/baixar-views.mjs \\');
  console.error('     --url https://sua-instancia.odoo.com --db seu_db --uid 2');
  console.error('\nNada vem preenchido de fábrica de propósito — veja a nota de');
  console.error('segurança no topo do arquivo.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

async function rpc(model, method, args = [], kwargs = {}) {
  const res = await fetch(`${CONFIG.url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [CONFIG.db, CONFIG.uid, CONFIG.apiKey, model, method, args, kwargs],
      },
    }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.data?.message || json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

const searchRead = (model, domain = [], fields = [], opts = {}) =>
  rpc(model, 'search_read', [domain], { fields, ...opts });

// ---------------------------------------------------------------------------
// Indentação do arch
//
// O Odoo devolve o arch numa linha só. Sem indentar não dá para ler nem
// comparar dois archs em diff.
//
// Um `>` dentro de valor de atributo quebraria a regex — mas em XML válido ele
// vem como `&gt;`, então o caso não ocorre num arch que o Odoo aceitou salvar.
// ---------------------------------------------------------------------------

function indentar(xml) {
  const plano = String(xml || '')
    .replace(/\r?\n\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();

  let nivel = 0;
  const linhas = [];

  for (const token of plano.split(/(<[^>]+>)/)) {
    const t = token.trim();
    if (!t) continue;

    const fechamento   = /^<\//.test(t);
    const autoFechada  = /\/>$/.test(t);
    const declaracao   = /^<[!?]/.test(t);
    const abertura     = /^</.test(t) && !fechamento && !autoFechada && !declaracao;

    if (fechamento) nivel = Math.max(0, nivel - 1);
    linhas.push('  '.repeat(nivel) + t);
    if (abertura) nivel++;
  }

  return linhas.join('\n');
}

// Nome de arquivo previsível e sem surpresa de sistema de arquivos.
const seguro = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);

// Impressão digital de um arch, para comparar duas versões.
//
// Normaliza espaço em branco antes de somar: o download indenta o XML, e o
// Odoo guarda como recebeu. Sem normalizar, "mesmo conteúdo, outra
// indentação" apareceria como mudança, e o --update reescreveria views
// idênticas a cada execução — sujando o histórico do Odoo sem motivo.
const digital = (xml) => createHash('sha256')
  .update(String(xml || '')
    // Entre tags primeiro: é aí que mora a indentação que o download
    // acrescenta. Só colapsar espaço em branco não basta — `><` e `> <`
    // continuariam diferentes, e toda view seria reescrita a cada execução.
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim())
  .digest('hex');

// Tira o comentário de anotação que o download escreve no topo do arquivo.
// Ele é nosso, não é parte do arch — subir junto poluiria a view no Odoo.
// Só o PRIMEIRO comentário, e só se vier antes de qualquer tag: um
// comentário que alguém escreveu dentro do arch é conteúdo, e fica.
const semCabecalho = (txt) => String(txt || '')
  .replace(/^\s*<!--[\s\S]*?-->\s*/, '')
  .trim();

// ---------------------------------------------------------------------------
// Operação
// ---------------------------------------------------------------------------

console.log(`\n🔌 ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})`);
console.log(`📐 modo=${CONFIG.modo}  tipo=${CONFIG.tipo}  modelos=${CONFIG.modelos.join(', ')}\n`);

// Sanity check antes de qualquer coisa: uma falha de auth aqui é uma mensagem
// clara, em vez de um erro obscuro no meio da operação.
try {
  const eu = await searchRead('res.users', [['id', '=', CONFIG.uid]], ['login'], { limit: 1 });
  if (!eu?.length) throw new Error('uid não encontrado');
} catch (e) {
  console.error(`❌ Falha de autenticação: ${e.message}`);
  console.error('   Confira URL, DB, UID e a API key.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MODO DOWNLOAD
// ---------------------------------------------------------------------------

async function baixar() {
  await mkdir(CONFIG.saida, { recursive: true });

  // A pasta se protege sozinha no primeiro uso: quem clonar o repo não recebe
  // archs por engano.
  //
  // SÓ se ainda não existir. Versionar os archs é uma decisão legítima — dá ao
  // app do Studio o histórico e o diff que ele não tem (achado D3) — e quem a
  // tomou apagou este arquivo. Reescrevê-lo a cada execução desfaria essa
  // escolha em silêncio, que é o pior jeito de discordar de alguém.
  const ignoreSaida = join(CONFIG.saida, '.gitignore');
  if (!existsSync(ignoreSaida)) {
    await writeFile(ignoreSaida, '*\n!.gitignore\n', 'utf8');
    console.log(`🔒 ${ignoreSaida} criado — apague-o para versionar os archs\n`);
  }

  const indice = { gerado_em: new Date().toISOString(), tipo: CONFIG.tipo, modelos: [] };

  for (const modelo of CONFIG.modelos) {
    console.log(`── ${modelo}`);
    const entrada = { modelo, views: [], combinada: null, erros: [] };

    let views = [];
    try {
      views = await searchRead(
        'ir.ui.view',
        [['model', '=', modelo], ['type', '=', CONFIG.tipo]],
        ['id', 'name', 'type', 'model', 'priority', 'inherit_id', 'mode', 'active', 'arch_db'],
        { order: 'priority,id' }
      );
    } catch (e) {
      console.log(`   ✗ ir.ui.view: ${e.message}`);
      entrada.erros.push(`ir.ui.view: ${e.message}`);
    }

    // A que módulo cada view pertence. É o que separa "tela nossa, do Studio"
    // de "tela do Odoo, que uma atualização vai sobrescrever de volta". O
    // --update usa isso para não gravar por cima do core (trava 4).
    const modulos = {};
    try {
      const dados = await searchRead(
        'ir.model.data',
        [['model', '=', 'ir.ui.view'], ['res_id', 'in', views.map((v) => v.id)]],
        ['res_id', 'module']
      );
      for (const d of dados) modulos[d.res_id] = d.module;
    } catch (e) {
      entrada.erros.push(`ir.model.data: ${e.message}`);
    }

    for (const v of views) {
      const heranca = v.inherit_id ? `herda de ${v.inherit_id[0]}` : 'base';
      const arquivo = `${seguro(modelo)}.${v.id}.${seguro(v.name)}.xml`;
      await writeFile(
        join(CONFIG.saida, arquivo),
        `<!-- ${modelo} · view ${v.id} · ${v.name} · ${heranca}`
          + ` · prioridade ${v.priority}${v.active ? '' : ' · INATIVA'} -->\n`
          + indentar(v.arch_db),
        'utf8'
      );
      const modulo = modulos[v.id] || null;
      const doCore = modulo && modulo !== 'studio_customization';
      console.log(`   ✓ ${arquivo}  (${heranca}${doCore ? `, do módulo ${modulo} — somente leitura` : ''})`);
      entrada.views.push({
        id: v.id, name: v.name, priority: v.priority, active: v.active,
        inherit_id: v.inherit_id ? v.inherit_id[0] : null, mode: v.mode, arquivo, modulo,
        // A impressão digital do que estava no Odoo AGORA. É ela que o
        // --update compara depois, para não passar por cima de uma alteração
        // feita no Studio nesse meio-tempo.
        hash: digital(v.arch_db),
      });
    }

    if (!views.length) console.log(`   · nenhuma view ${CONFIG.tipo} registrada`);

    // A view COMBINADA — o Odoo aplicando as heranças. É o que o usuário vê, e
    // para res.users é a única leitura que significa alguma coisa.
    //
    // `get_view` é o método do Odoo 17+. `fields_view_get` é o nome antigo, e
    // fica como reserva: custa três linhas e evita o script morrer numa base
    // mais velha.
    let combinada = null;
    for (const metodo of ['get_view', 'fields_view_get']) {
      try {
        const r = metodo === 'get_view'
          ? await rpc(modelo, 'get_view', [false, CONFIG.tipo])
          : await rpc(modelo, 'fields_view_get', [], { view_type: CONFIG.tipo });
        if (r?.arch) { combinada = { metodo, arch: r.arch, view_id: r.id || null }; break; }
      } catch (e) {
        entrada.erros.push(`${metodo}: ${e.message}`);
      }
    }

    if (combinada) {
      const arquivo = `${seguro(modelo)}.COMBINADA.xml`;
      await writeFile(
        join(CONFIG.saida, arquivo),
        `<!-- ${modelo} · ${CONFIG.tipo} combinada (via ${combinada.metodo})`
          + ` · view ${combinada.view_id ?? '?'}\n`
          + `     SOMENTE LEITURA: é o resultado das heranças, não existe como`
          + ` registro. O --update ignora este arquivo. -->\n`
          + indentar(combinada.arch),
        'utf8'
      );
      console.log(`   ✓ ${arquivo}  ← é esta que você quer ler`);
      entrada.combinada = { arquivo, metodo: combinada.metodo, view_id: combinada.view_id };
    } else {
      console.log(`   ✗ não consegui a view combinada`);
    }

    indice.modelos.push(entrada);
  }

  await writeFile(join(CONFIG.saida, 'indice.json'), JSON.stringify(indice, null, 2), 'utf8');

  const total = indice.modelos.reduce((n, m) => n + m.views.length, 0);
  console.log(`\n✅ ${total} view(s) + ${indice.modelos.filter((m) => m.combinada).length} combinada(s)`);
  console.log(`   em ${CONFIG.saida}/  (índice em indice.json)\n`);
}

// ---------------------------------------------------------------------------
// MODO UPDATE
//
// Sobe de volta o que está nos arquivos. Três travas, e cada uma existe por
// um jeito diferente de estragar a instância:
//
//   1. Só sobe o que o indice.json mapeia para um id de view real. O script
//      não adivinha alvo a partir do nome do arquivo.
//   2. NUNCA sobe um .COMBINADA.xml. Aquilo é o resultado das heranças, não
//      um registro: gravá-lo na view base duplicaria o que a herança já
//      acrescenta, e o Studio passaria a brigar com ele.
//   3. Compara a impressão digital guardada no download com o que está no
//      Odoo agora. Se alguém mexeu no Studio nesse meio-tempo, o arquivo
//      local está velho e subir apagaria o trabalho da pessoa. Nesse caso
//      pula e diz — `--forcar` passa por cima, para quem realmente quis.
// ---------------------------------------------------------------------------

async function atualizar() {
  const caminhoIndice = join(CONFIG.saida, 'indice.json');
  if (!existsSync(caminhoIndice)) {
    console.error(`❌ ${caminhoIndice} não existe.`);
    console.error('   Rode `--download` primeiro: é ele que diz qual arquivo é qual view.');
    process.exit(1);
  }

  const indice = JSON.parse(readFileSync(caminhoIndice, 'utf8'));
  let enviadas = 0, iguais = 0, puladas = 0, falhas = 0;

  for (const entrada of indice.modelos) {
    if (!CONFIG.modelos.includes(entrada.modelo)) continue;
    console.log(`── ${entrada.modelo}`);

    // A que módulo pertence cada view, perguntado AGORA e não lido do
    // indice.json: assim a trava 4 vale também para um índice baixado antes
    // de ela existir. Uma consulta por modelo, não por view.
    const modulos = {};
    try {
      const dados = await searchRead(
        'ir.model.data',
        [['model', '=', 'ir.ui.view'], ['res_id', 'in', entrada.views.map((v) => v.id)]],
        ['res_id', 'module']
      );
      for (const d of dados) modulos[d.res_id] = d.module;
    } catch (e) {
      console.log(`   ⚠️  não consegui checar os módulos: ${e.message}`);
      console.log(`      sem isso eu não distingo view do Studio de view do core — parando.`);
      process.exit(1);
    }

    for (const v of entrada.views) {
      const caminho = join(CONFIG.saida, v.arquivo);
      if (!existsSync(caminho)) {
        console.log(`   · ${v.arquivo} — não está no disco, pulando`);
        continue;
      }

      // O comentário que o download escreve no topo é anotação nossa, não
      // parte do arch. Sobe sem ele.
      const local = semCabecalho(readFileSync(caminho, 'utf8'));
      if (!local) {
        console.log(`   · ${v.arquivo} — vazio, pulando`);
        continue;
      }

      // Trava 4: view que pertence a um módulo do Odoo não é nossa para
      // reescrever. Uma atualização do módulo devolveria o arch original,
      // e até lá a mudança valeria para telas que nada têm a ver com este
      // projeto. Customização de view do core se faz por herança — que é
      // exatamente o que as views do studio_customization são.
      // Sem `--forcar` aqui, de propósito: os riscos são de naturezas
      // diferentes. A trava 3 diz "seu arquivo está velho", e é recuperável.
      // Esta diz "isto não é seu para reescrever", e o estrago atinge telas
      // fora deste projeto. Quem tiver mesmo esse caso usa o Odoo direto.
      const modulo = modulos[v.id];
      if (modulo && modulo !== 'studio_customization') {
        console.log(`   🔒 view ${v.id} (${v.name})`);
        console.log(`      é do módulo \`${modulo}\`, não do Studio — não vou gravar.`);
        console.log(`      Para mudar essa tela, edite a view herdada do Studio.`);
        puladas++;
        continue;
      }

      let atual;
      try {
        const r = await searchRead('ir.ui.view', [['id', '=', v.id]], ['arch_db'], { limit: 1 });
        if (!r?.length) throw new Error('view não existe mais');
        atual = r[0].arch_db;
      } catch (e) {
        console.log(`   ✗ view ${v.id}: ${e.message}`);
        falhas++;
        continue;
      }

      if (digital(atual) === digital(local)) { iguais++; continue; }

      // Trava 3: o Odoo mudou desde o download?
      if (v.hash && digital(atual) !== v.hash && !CONFIG.forcar) {
        console.log(`   ⚠️  view ${v.id} (${v.name})`);
        console.log(`      mudou no Odoo depois do seu download — seu arquivo está velho.`);
        console.log(`      Rode --download de novo, ou --forcar para sobrescrever mesmo assim.`);
        puladas++;
        continue;
      }

      if (CONFIG.simular) {
        console.log(`   ~ view ${v.id} (${v.name}) — MUDARIA (${atual.length} → ${local.length} chars)`);
        enviadas++;
        continue;
      }

      try {
        await rpc('ir.ui.view', 'write', [[v.id], { arch: local }]);
        console.log(`   ✓ view ${v.id} (${v.name}) atualizada`);
        enviadas++;
      } catch (e) {
        // O Odoo valida o arch no write. Uma mensagem dele aqui é diagnóstico,
        // não ruído — é ela que diz qual xpath não casou.
        console.log(`   ✗ view ${v.id} (${v.name}): ${e.message}`);
        falhas++;
      }
    }

    if (entrada.combinada) {
      console.log(`   · ${entrada.combinada.arquivo} — somente leitura, ignorado (trava 2)`);
    }
  }

  const verbo = CONFIG.simular ? 'mudariam' : 'atualizadas';
  console.log(`\n${falhas ? '⚠️' : '✅'} ${enviadas} ${verbo}, ${iguais} sem diferença,`
    + ` ${puladas} pulada(s), ${falhas} falha(s)\n`);
  if (CONFIG.simular) console.log('   (simulação: nada foi gravado — tire o --simular para valer)\n');
  if (falhas) process.exitCode = 1;
}

await (CONFIG.modo === 'update' ? atualizar() : baixar());
