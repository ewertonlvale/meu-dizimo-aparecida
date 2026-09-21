/**
 * baixar-views.mjs — Leva e traz as views do app inteiro, entre o Odoo e o git.
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
 *   Para os modelos do Studio, sem herança, as duas costumam coincidir. Para
 *   res.users, não: é ali que a diferença conta.
 *
 * O QUE ELE PEGA, POR PADRÃO
 *   TODOS os modelos personalizados e TODOS os tipos de view (list, form,
 *   kanban, search, pivot…). Nada de lista fixa: modelo se descobre no Odoo,
 *   porque lista escrita à mão envelhece sozinha — a tela criada amanhã
 *   ficaria de fora sem ninguém notar, e é justamente ela que precisa de
 *   revisão. `--modelos` e `--tipo` continuam servindo para estreitar.
 *
 *   "Personalizado" é a união de duas coisas: os modelos criados no Studio
 *   (state manual, ou nome x_*) e os modelos de qualquer view que pertença ao
 *   módulo studio_customization — é assim que res.users entra, porque a tela
 *   dele foi mexida aqui.
 *
 * A PASTA É UM ESPELHO
 *   Na varredura completa, arquivo que sobrou e não corresponde a nenhuma view
 *   é removido, um a um e dito em voz alta — view apagada no Odoo não deve
 *   continuar no disco fingindo que existe. Com `--modelos` ou `--tipo` isso
 *   não acontece: a varredura viu um pedaço, e apagar o resto seria apagar o
 *   que nem foi olhado.
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
 *     --modelos x_dizimista,x_devolucao   (padrão: todos os personalizados)
 *     --tipo    kanban                    (padrão: todos os tipos)
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

import { writeFile, mkdir, readdir, rm } from 'node:fs/promises';
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
  // Sem valor fixo nos dois: o padrão é TUDO, descoberto no Odoo.
  //
  // Lista fixa de modelo envelhece sozinha — um modelo criado no Studio
  // amanhã ficaria de fora sem ninguém notar, e é justamente a tela nova que
  // mais precisa de revisão. Lista fixa de tipo escondia list, form e search,
  // que são onde o trabalho acontece.
  tipo:  arg('tipo') || null,
  saida: arg('saida') || 'ferramentas/views-odoo',
  modelos: arg('modelos') ? arg('modelos').split(',').map((m) => m.trim()).filter(Boolean) : null,
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
console.log(`📐 modo=${CONFIG.modo}`
  + `  tipo=${CONFIG.tipo || 'todos'}`
  + `  modelos=${CONFIG.modelos ? CONFIG.modelos.join(', ') : 'todos os personalizados'}\n`);

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

/**
 * Quais modelos este app personaliza.
 *
 * Duas fontes, unidas, porque nenhuma sozinha responde:
 *
 *   - `ir.model` com state 'manual' ou nome x_*  — os modelos criados no
 *     Studio. São o próprio app.
 *   - os modelos de qualquer view que pertença ao `studio_customization` —
 *     é assim que res.users entra. Ele não é modelo nosso, mas a tela dele
 *     foi mexida aqui, e uma tela mexida é tela para revisar.
 *
 * O `x_parametros_line_...` e afins entram por serem manual. É o certo: uma
 * linha de tabela também tem view, e foi numa dessas que a análise achou
 * quatro campos invisíveis.
 */
async function descobrirModelos() {
  const achados = new Set();

  const modelos = await searchRead('ir.model', [], ['model', 'state']);
  for (const m of modelos) {
    if (m.state === 'manual' || m.model.startsWith('x_')) achados.add(m.model);
  }

  try {
    const dados = await searchRead(
      'ir.model.data',
      [['module', '=', 'studio_customization'], ['model', '=', 'ir.ui.view']],
      ['res_id']
    );
    if (dados.length) {
      const views = await searchRead(
        'ir.ui.view', [['id', 'in', dados.map((d) => d.res_id)]], ['model']
      );
      for (const v of views) if (v.model) achados.add(v.model);
    }
  } catch (e) {
    console.log(`   ⚠️  não li o studio_customization: ${e.message}`);
    console.log(`      modelos do core personalizados (res.users) podem ficar de fora.`);
  }

  return [...achados].sort();
}

async function baixar() {
  // A pasta se protege sozinha NO PRIMEIRO USO: quem clonar o repo e rodar o
  // download não recebe archs versionados por engano.
  //
  // A condição é a PASTA não existir, não o .gitignore. A primeira versão
  // disto checava o arquivo, e era um laço fechado: versionar os archs se
  // decide APAGANDO esse .gitignore, e ausência era justamente o gatilho para
  // recriá-lo. O download seguinte desfazia a decisão em silêncio, e os
  // arquivos novos sumiam do `git add` sem ninguém entender por quê.
  //
  // Pasta já existente significa que alguém já usou isto e já arrumou como
  // queria. Não é nosso lugar opinar de novo.
  const pastaNova = !existsSync(CONFIG.saida);
  await mkdir(CONFIG.saida, { recursive: true });

  if (pastaNova) {
    await writeFile(join(CONFIG.saida, '.gitignore'), '*\n!.gitignore\n', 'utf8');
    console.log(`🔒 ${join(CONFIG.saida, '.gitignore')} criado`
      + ` — apague-o para versionar os archs\n`);
  }

  const alvos = CONFIG.modelos || await descobrirModelos();
  if (!CONFIG.modelos) console.log(`🔎 ${alvos.length} modelo(s) personalizado(s)\n`);

  const indice = {
    gerado_em: new Date().toISOString(),
    tipo: CONFIG.tipo || 'todos',
    modelos: [],
  };
  // Tudo que este download escreveu. O que sobrar na pasta e não estiver aqui
  // é restos de um download anterior — view apagada no Odoo, ou renomeada.
  const escritos = new Set(['.gitignore', 'indice.json']);

  for (const modelo of alvos) {
    console.log(`── ${modelo}`);
    const entrada = { modelo, views: [], combinadas: [], erros: [] };

    let views = [];
    try {
      views = await searchRead(
        'ir.ui.view',
        CONFIG.tipo ? [['model', '=', modelo], ['type', '=', CONFIG.tipo]]
                    : [['model', '=', modelo]],
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
      // O tipo entra no nome porque os nomes que o Studio gera não ajudam
      // ("Default kanban view for ir.model(443,)"). Com seis modelos e todos
      // os tipos são dezenas de arquivos, e achar "a list de dizimista"
      // precisa ser olhar, não abrir.
      const arquivo = `${seguro(modelo)}.${seguro(v.type)}.${v.id}.${seguro(v.name)}.xml`;
      await writeFile(
        join(CONFIG.saida, arquivo),
        `<!-- ${modelo} · view ${v.id} · ${v.name} · ${heranca}`
          + ` · ${v.type} · prioridade ${v.priority}${v.active ? '' : ' · INATIVA'} -->\n`
          + indentar(v.arch_db),
        'utf8'
      );
      const modulo = modulos[v.id] || null;
      const doCore = modulo && modulo !== 'studio_customization';
      console.log(`   ✓ ${arquivo}  (${heranca}${doCore ? `, do módulo ${modulo} — somente leitura` : ''})`);
      escritos.add(arquivo);
      entrada.views.push({
        id: v.id, name: v.name, tipo: v.type, priority: v.priority, active: v.active,
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
    // Só os tipos que REALMENTE têm view registrada. Pedir `get_view` de um
    // tipo sem view faz o Odoo gerar um default na hora — um arquivo que não
    // corresponde a nada no banco e que ninguém pode editar de volta.
    const tipos = [...new Set(views.map((v) => v.type))].sort();

    for (const tipo of tipos) {
      let combinada = null;
      for (const metodo of ['get_view', 'fields_view_get']) {
        try {
          const r = metodo === 'get_view'
            ? await rpc(modelo, 'get_view', [false, tipo])
            : await rpc(modelo, 'fields_view_get', [], { view_type: tipo });
          if (r?.arch) { combinada = { metodo, arch: r.arch, view_id: r.id || null }; break; }
        } catch (e) {
          entrada.erros.push(`${tipo}/${metodo}: ${e.message}`);
        }
      }

      if (!combinada) { console.log(`   ✗ combinada de ${tipo}: não consegui`); continue; }

      const arquivo = `${seguro(modelo)}.${seguro(tipo)}.COMBINADA.xml`;
      await writeFile(
        join(CONFIG.saida, arquivo),
        `<!-- ${modelo} · ${tipo} combinada (via ${combinada.metodo})`
          + ` · view ${combinada.view_id ?? '?'}\n`
          // "--" dentro de comentário XML é ilegal, e este cabeçalho dizia
          // "O --update ignora...": 37 arquivos saindo malformados. Não
          // quebrava o script (COMBINADA nunca é lido de volta), mas qualquer
          // editor de XML recusa. O traço longo diz a mesma coisa e é válido.
          + `     SOMENTE LEITURA: é o resultado das heranças, não existe como`
          + ` registro. O modo –update ignora este arquivo. -->\n`
          + indentar(combinada.arch),
        'utf8'
      );
      console.log(`   ✓ ${arquivo}  ← é esta que você quer ler`);
      escritos.add(arquivo);
      entrada.combinadas.push({ tipo, arquivo, metodo: combinada.metodo, view_id: combinada.view_id });
    }

    indice.modelos.push(entrada);
  }

  await writeFile(join(CONFIG.saida, 'indice.json'), JSON.stringify(indice, null, 2), 'utf8');

  // A pasta é um espelho do Odoo, e espelho não guarda o que sumiu. O que
  // sobrou aqui é de um download anterior: view apagada no Odoo, ou arquivo
  // que mudou de nome quando o tipo passou a entrar nele.
  //
  // Apagar dá um susto justo, então cada remoção é dita em voz alta. E o
  // git tem todos eles — é por isso que dá para fazer isso com tranquilidade.
  //
  // Só acontece na varredura completa: com --modelos ou --tipo o download
  // viu um pedaço, e apagar o resto seria apagar o que nem foi olhado.
  if (!CONFIG.modelos && !CONFIG.tipo) {
    const sobrando = (await readdir(CONFIG.saida))
      .filter((f) => f.endsWith('.xml') && !escritos.has(f));
    for (const f of sobrando) {
      await rm(join(CONFIG.saida, f));
      console.log(`🗑️  ${f} — não existe mais no Odoo (ou mudou de nome), removido`);
    }
    if (sobrando.length) console.log('');
  }

  const total = indice.modelos.reduce((n, m) => n + m.views.length, 0);
  const comb  = indice.modelos.reduce((n, m) => n + m.combinadas.length, 0);
  console.log(`\n✅ ${indice.modelos.length} modelo(s), ${total} view(s) + ${comb} combinada(s)`);
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
    if (CONFIG.modelos && !CONFIG.modelos.includes(entrada.modelo)) continue;
    if (CONFIG.tipo && !entrada.views.some((v) => !v.tipo || v.tipo === CONFIG.tipo)) continue;
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
      if (CONFIG.tipo && v.tipo && v.tipo !== CONFIG.tipo) continue;
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

    // Aceita o índice novo (uma combinada por tipo) e o antigo (uma só), para
    // um --update com índice de antes desta mudança não quebrar.
    const combinadas = entrada.combinadas || (entrada.combinada ? [entrada.combinada] : []);
    if (combinadas.length) {
      console.log(`   · ${combinadas.length} combinada(s) — somente leitura, ignorada(s) (trava 2)`);
    }
  }

  const verbo = CONFIG.simular ? 'mudariam' : 'atualizadas';
  console.log(`\n${falhas ? '⚠️' : '✅'} ${enviadas} ${verbo}, ${iguais} sem diferença,`
    + ` ${puladas} pulada(s), ${falhas} falha(s)\n`);
  if (CONFIG.simular) console.log('   (simulação: nada foi gravado — tire o --simular para valer)\n');
  if (falhas) process.exitCode = 1;
}

await (CONFIG.modo === 'update' ? atualizar() : baixar());
