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

function subir(cenario, porta) {
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
];

let porta = 8900;
let falhas = 0;

console.log('\n🧪 O verificador do BL-17 contra um Odoo de mentira\n');

for (const c of CENARIOS) {
  const servidor = await subir(c.nome, ++porta);

  const r = await new Promise((ok) =>
    execFile('node', ['ferramentas/instalar-usuario-bot.mjs', '--verificar'], {
      cwd: RAIZ,
      env: { ...process.env,
        ODOO_URL: `http://127.0.0.1:${porta}`, ODOO_DB: 'mentira',
        ODOO_UID: '140', ODOO_API_KEY: 'chave-de-mentira',
        ODOO_ENV_FILE: '/dev/null', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
    }, (e, saida, err) => ok({ code: e ? e.code : 0, txt: saida + err })));

  servidor.close();

  const codeOk = r.code === c.saida;
  const txtOk  = c.espera.test(r.txt);
  const ok = codeOk && txtOk;
  if (!ok) falhas++;

  console.log(`${ok ? '✅' : '❌'} ${c.nome.padEnd(17)} exit ${r.code} (esperado ${c.saida})`
    + (ok ? '' : `\n     ${txtOk ? '' : 'não disse ' + c.espera}`));
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
