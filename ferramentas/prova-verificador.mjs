#!/usr/bin/env node
/**
 * prova-verificador.mjs — o verificador do BL-17 responde certo quando dá errado?
 *
 * POR QUE ISTO EXISTE
 *   `instalar-usuario-bot.mjs --verificar` é o comando que decide se o bot
 *   deixou de ser administrador. Ele já falhou QUATRO vezes, sempre da mesma
 *   forma: errando para o lado do "está tudo certo".
 *
 *     1. `check_access_rights`, que não existe mais na saas-19.3
 *     2. grupo de admin buscado por nome em inglês, num Odoo em português
 *     3. `res.partner` contado como sobra, sendo o piso do usuário interno
 *     4. uid inexistente devolvendo ✅ e exit 0; e usuário AINDA ADMINISTRADOR
 *        também saindo com exit 0, porque o código de saída só olhava `faltando`
 *     5. `has_access` chamado como `[op]` em vez de `[[], op]` — o `call_kw`
 *        do Odoo consome `args[0]` como lista de ids. Esta prova NÃO pegou,
 *        porque o mock lia `args[0]` como a operação: repetia o engano de quem
 *        chamava e portanto o abençoava. Corrigido: o mock agora reproduz o
 *        despacho `_call_kw_multi` e recusa a forma errada.
 *     6. `res.users.groups_id`, que na saas-19.3 virou `group_ids` (e
 *        `all_group_ids` para os implicados). Quebrava `--explicar` e
 *        `--aplicar --login=` — dois modos que esta prova NEM EXERCITAVA.
 *        Agora o mock valida nomes de campo contra os do Odoo real e há
 *        cenário para cada modo.
 *
 *   Um verificador que aprova quando não sabe é pior que verificador nenhum:
 *   ele encerra a investigação. Ler o código não pegou nenhuma das quatro —
 *   as três primeiras passaram por revisão. Só executar pega.
 *
 * O QUE FAZ
 *   Sobe um Odoo de mentira em localhost, um por cenário, e roda o verificador
 *   de verdade contra ele. Nada sai para a rede; nenhuma credencial é usada.
 *
 *     node ferramentas/prova-verificador.mjs
 *
 *   Sai 1 se qualquer cenário responder diferente do esperado.
 */

import http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// O que um usuário do bot CORRETAMENTE configurado responderia. Espelha a
// MATRIZ do instalador, mais o piso de `base.group_user`.
const PERMISSOES = {
  'x_devolucao':       { read: 1, write: 1, create: 1 },
  'x_dizimista':       { read: 1, write: 1, create: 1 },
  'x_contato_bot':     { read: 1, write: 1, create: 1 },
  'x_notificacao_log': { read: 1, create: 1 },
  'x_comunidade':      { read: 1 },
  'x_parametros':      { read: 1 },
  'x_parametros_line_c498a': { read: 1 },
  'ir.model.fields':   { read: 1 },
  'res.users':         { read: 1 },
  // piso do usuário interno — esperado, não é sobra
  'res.partner':       { write: 1 },
  'ir.attachment':     { write: 1 },
  'mail.message':      { write: 1 },
};

const SO_ADMIN = ['ir.ui.view', 'ir.cron', 'res.groups'];

// Os campos que EXISTEM de verdade, conferidos no código-fonte da saas-19.3
// (odoo/addons/base/models/*.py). O Odoo recusa campo inexistente com
// `ValueError: Invalid field 'x' on 'y'`, e o mock passou a fazer o mesmo.
//
// Sem isto, escrever `groups_id` (que virou `group_ids` nesta versão) passava
// batido aqui e só quebrava em produção. É a sexta falha desta família —
// nome de API escrito de memória — e a primeira com defesa automática.
const CAMPOS = {
  'res.users': ['id', 'name', 'login', 'group_ids', 'all_group_ids', 'active'],
  'res.groups': ['id', 'name', 'users', 'implied_ids', 'all_implied_ids'],
  'ir.model': ['id', 'model', 'name'],
  'ir.model.data': ['id', 'name', 'module', 'model', 'res_id'],
  'ir.model.access': ['id', 'name', 'model_id', 'group_id',
                      'perm_read', 'perm_write', 'perm_create', 'perm_unlink'],
};

function subir(cenario, porta, gravado = []) {
  return new Promise((pronto) => {
    const s = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const { params } = JSON.parse(corpo);
        const [, uid, , model, method, args] = params.args;
        const erro = (name, message) =>
          res.end(JSON.stringify({ error: { message: 'Odoo Server Error', data: { name, message } } }));

        // Credencial recusada: o Odoo nega ANTES de chegar ao método.
        if (cenario === 'credencial') return erro('odoo.exceptions.AccessDenied', 'Access Denied');

        if (method === 'read' && model === 'res.users') {
          return res.end(JSON.stringify({
            result: cenario === 'uid-inexistente'
              ? []
              : [{ id: uid, login: 'bot@exemplo.org', name: 'Bot de Mentira' }],
          }));
        }

        // Campo inexistente: o Odoo devolve ValueError, não silêncio.
        const pedidos = method === 'read' ? (args[1] || [])
                      : (params.args[6] || {}).fields || [];
        const validos = CAMPOS[model];
        if (validos) {
          const mau = pedidos.find((f) => !validos.includes(f));
          if (mau) return erro('builtins.ValueError', `Invalid field '${mau}' on '${model}'`);
        }

        if (method === 'search_read') {
          if (model === 'ir.model.access')  return res.end(JSON.stringify({ result: ACLS[cenario] || [] }));
          if (model === 'ir.model')         return res.end(JSON.stringify({ result: [{ id: 9, model: 'x_comunidade' }] }));
          if (model === 'ir.model.data')    return res.end(JSON.stringify({
            result: cenario.startsWith('restringir') ? [{ id: 1, name: 'group_user', res_id: 1 }] : [] }));
          if (model === 'res.users')        return res.end(JSON.stringify({
            result: [{ id: 13, name: 'Bot de Mentira', login: 'bot@exemplo.org',
                       group_ids: [1, 7], all_group_ids: [1, 7, 12] }] }));
          return res.end(JSON.stringify({ result: [] }));
        }

        // --restringir grava em ir.model.access. O mock registra o que foi
        // gravado para o cenário poder afirmar QUE regras foram tocadas.
        if (method === 'write' && model === 'ir.model.access') {
          gravado.push({ ids: args[0], vals: args[1] });
          return res.end(JSON.stringify({ result: true }));
        }

        if (method === 'has_access') {
          // ── O despacho de verdade do Odoo, e não o que eu supunha ────────
          //
          // Este mock lia `args[0]` como a operação — o MESMO engano de quem
          // chamava. Resultado: a prova passava com a chamada errada, e só o
          // Odoo real acusou, 39 vezes seguidas:
          //
          //   BaseModel.has_access() missing 1 required positional argument
          //
          // Em `odoo/api.py`, método que não é `@api.model` vai por
          // `_call_kw_multi`, que faz `ids, args = args[0], args[1:]`. O
          // primeiro argumento é SEMPRE consumido como lista de ids.
          //
          // Um mock que repete o engano de quem chama valida o engano. Aqui
          // ele passou a reproduzir o despacho — e a recusar a forma errada
          // com a mensagem que o Odoo dá.
          const [ids, operacao] = args;
          if (!Array.isArray(ids) || operacao === undefined) {
            return erro('builtins.TypeError',
              "BaseModel.has_access() missing 1 required positional argument: 'operation'");
          }

          // Erro que NÃO é de permissão: o verificador tem de dizer "não sei".
          if (cenario === 'rede-instavel' && model === 'x_dizimista') return erro('', 'ECONNRESET');
          if (cenario === 'ainda-admin' && SO_ADMIN.includes(model)) {
            return res.end(JSON.stringify({ result: true }));
          }
          // A situação real de 24/09: o usuário NÃO é administrador, mas uma
          // outra regra de ir.model.access — a que o Studio cria com o modelo
          // — concede escrita nos x_*. ACL do Odoo soma; o grupo restritivo
          // não anula a permissiva. São diagnósticos diferentes e não podem
          // sair com a mesma frase.
          if (cenario === 'sobra-no-bot' && model.startsWith('x_')) {
            return res.end(JSON.stringify({ result: true }));
          }
          return res.end(JSON.stringify({ result: !!(PERMISSOES[model] || {})[operacao] }));
        }

        res.end(JSON.stringify({ result: [] }));
      });
    });
    s.listen(porta, '127.0.0.1', () => pronto(s));
  });
}

// As regras de ir.model.access que cada cenário de --explicar enxerga.
// `model_id` volta como [id, RÓTULO amigável] — e é justamente por isso que o
// script tem de resolver o nome técnico via ir.model em vez de casar pelo
// rótulo. Aqui o rótulo é propositalmente diferente do nome técnico.
const ACLS = {
  'explicar-limpo': [
    { id: 1, name: 'meu_dizimo_bot_x_comunidade', model_id: [9, 'Comunidade'],
      group_id: [7, 'Meu Dízimo · Bot'],
      perm_read: true, perm_write: false, perm_create: false, perm_unlink: false },
  ],
  'explicar-culpado': [
    { id: 1, name: 'meu_dizimo_bot_x_comunidade', model_id: [9, 'Comunidade'],
      group_id: [7, 'Meu Dízimo · Bot'],
      perm_read: true, perm_write: false, perm_create: false, perm_unlink: false },
    // A regra que o Studio cria: sem grupo, vale para todo mundo.
    { id: 2, name: 'x_comunidade_studio_access', model_id: [9, 'Comunidade'],
      group_id: false,
      perm_read: true, perm_write: true, perm_create: true, perm_unlink: false },
  ],
};

// Para --restringir: o que base.group_user concede nos x_*. Espelha o achado
// real de 24/09 — a regra do Studio dando escrita a todo usuário interno.
ACLS['restringir-com-excesso'] = [
  { id: 11, name: 'Comunidade group_user', model_id: [9, 'Comunidade'],
    group_id: [1, 'Role / User'],
    perm_read: true, perm_write: true, perm_create: true, perm_unlink: false },
];
ACLS['restringir-ja-certo'] = [
  { id: 11, name: 'Comunidade group_user', model_id: [9, 'Comunidade'],
    group_id: [1, 'Role / User'],
    perm_read: true, perm_write: false, perm_create: false, perm_unlink: false },
];

const CENARIOS = [
  { nome: 'uid-inexistente', saida: 1, espera: /NÃO EXISTE/,
    porque: 'uid digitado errado não pode receber atestado de boa conduta' },
  { nome: 'credencial', saida: 1, espera: /credencial recusada/,
    porque: 'AccessDenied é credencial, não permissão — dizer "sobrando" acusa o inocente' },
  { nome: 'rede-instavel', saida: 1, espera: /INDETERMINADA/,
    porque: 'erro de rede é ignorância, e ignorância não vira veredito' },
  { nome: 'ainda-admin', saida: 1, espera: /ainda é admin/,
    porque: 'é a condição que o BL-17 existe para detectar — não pode sair com zero' },
  { nome: 'sobra-no-bot', saida: 1, espera: /NÃO é poder de administrador/,
    porque: 'sobra por ACL aditiva não é admin — dizer que é manda procurar no lugar errado' },
  { nome: 'feliz', saida: 0, espera: /✅/,
    porque: 'e o caminho certo tem de passar, senão o resto não prova nada' },
  // Os dois modos abaixo NÃO eram exercitados, e foi neles que o `groups_id`
  // quebrou. Cobrir só um terço do script é cobrir um terço do script.
  { nome: 'explicar-limpo', modo: 'explicar', saida: 0, espera: /Nenhuma regra concede/,
    porque: '--explicar precisa ao menos rodar: era ele que estourava no campo morto' },
  { nome: 'explicar-culpado', modo: 'explicar', saida: 1, espera: /SEM GRUPO/,
    porque: 'a regra do Studio, sem grupo, é a que concede a mais — tem de ser nomeada' },
  // --restringir mexe na permissão de TODOS os usuários internos. Simular por
  // padrão não é gentileza, é a diferença entre revisável e irreversível.
  { nome: 'restringir-com-excesso', modo: 'restringir', saida: 0, espera: /Nada foi gravado/,
    porque: 'sem --aplicar não pode gravar nada, por mais óbvia que a mudança pareça',
    confere: (g) => (g.length === 0 ? null : `gravou ${g.length} vez(es) em modo simulação`) },
  { nome: 'restringir-ja-certo', modo: 'restringir', saida: 0, espera: /Nada a restringir/,
    porque: 'rodar de novo depois de aplicado não pode inventar mudança' },
];

let porta = 8900;
let falhas = 0;

console.log('\n🧪 O verificador do BL-17 contra um Odoo de mentira\n');

for (const c of CENARIOS) {
  const gravado = [];
  const servidor = await subir(c.nome, ++porta, gravado);

  const r = await new Promise((ok) =>
    execFile('node', c.modo === 'explicar'
      ? ['ferramentas/instalar-usuario-bot.mjs', '--explicar', '--login=bot@exemplo.org']
      : c.modo === 'restringir'
      ? ['ferramentas/instalar-usuario-bot.mjs', '--restringir']
      : ['ferramentas/instalar-usuario-bot.mjs', '--verificar'], {
      cwd: RAIZ,
      env: { ...process.env,
        ODOO_URL: `http://127.0.0.1:${porta}`, ODOO_DB: 'mentira',
        ODOO_UID: '140', ODOO_API_KEY: 'chave-de-mentira',
        ODOO_ENV_FILE: '/dev/null', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
    }, (e, saida, err) => ok({ code: e ? e.code : 0, txt: saida + err })));

  servidor.close();

  const codeOk = r.code === c.saida;
  const txtOk  = c.espera.test(r.txt);
  const extra = c.confere ? c.confere(gravado) : null;
  const ok = codeOk && txtOk && !extra;
  if (!ok) falhas++;

  console.log(`${ok ? '✅' : '❌'} ${c.nome.padEnd(17)} exit ${r.code} (esperado ${c.saida})`
    + (ok ? '' : `\n     ${txtOk ? '' : 'não disse ' + c.espera}${extra ? ' ' + extra : ''}`));
  console.log(`   ${c.porque}`);
}

console.log('');
if (falhas) {
  console.log(`❌ ${falhas} cenário(s) fora do esperado.`);
  console.log('   Este é o script que decide se o bot deixou de ser administrador.');
  console.log('   Não o publique assim.\n');
  process.exit(1);
}
console.log(`✅ Os ${CENARIOS.length} cenários respondem como devem.\n`);
