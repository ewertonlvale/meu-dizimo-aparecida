#!/usr/bin/env node
/**
 * ============================================================================
 * VALIDA-FLOW.JS — confere o Flow JSON antes de colar no Flow Builder
 * ============================================================================
 *
 * POR QUE EXISTE
 *   O validador da Meta só roda depois de colar o arquivo lá, e as regras que
 *   ele cobra NÃO estão escritas no arquivo — descobrem-se uma por vez, a cada
 *   recusa. Três idas e voltas construindo estes dois Flows:
 *
 *     1. "label must be 20 characters or less"
 *     2. "Property 'init-value' is not allowed in 'TextInput' component"
 *     3. "Expected property 'dia_preferido' to be of type 'number'"
 *     4. (sem erro nenhum) "Comunidade: ${data.comunidade}" apareceu LITERAL na
 *        tela do aparelho — o binding só resolve a string inteira, e o Flow
 *        Builder aceita a mistura sem reclamar
 *     5. "Property 'helper-text' is not allowed in 'Dropdown' component"
 *
 *   A regra 6 é diferente das outras: não é recusa da Meta, é decisão deste
 *   projeto — Dropdown não vem pré-selecionado. Ver o comentário dela.
 *
 *   Cada uma custou um ciclo de editar, colar, ler o erro. Este script cobra as
 *   mesmas regras aqui, em segundos.
 *
 * ⚠️ NÃO SUBSTITUI o validador da Meta — cobre só o que já nos mordeu. Uma
 *    recusa nova é motivo para acrescentar uma regra aqui, não para desconfiar
 *    do arquivo.
 *
 * USO
 *   node ferramentas/valida-flow.js                    # todos os flow-*.json
 *   node ferramentas/valida-flow.js caminho/para.json
 */

const fs   = require('fs');
const path = require('path');

const LIMITES = { label: 20, 'helper-text': 80, text: 80, title: 30 };

// Regra 5, descoberta em 19/09 publicando o formulário de oferta:
// "Property 'helper-text' is not allowed in 'Dropdown' component."
//
// Nem toda propriedade vale para todo componente, e o erro só aparece ao colar
// no Flow Builder — o campo existe, o JSON é válido, e mesmo assim é recusado.
// Cada linha aqui é uma recusa REAL da Meta, não uma suposição sobre o schema.
const PROIBIDO_POR_COMPONENTE = {
  Dropdown: ['helper-text']
};

function componentes(form) {
  return (form.children || []).filter(c => c.name);
}

function validar(arquivo) {
  const problemas = [];
  const aviso = (onde, msg) => problemas.push(`${onde}: ${msg}`);

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (e) {
    return [`JSON inválido — ${e.message}`];
  }

  for (const tela of doc.screens || []) {
    const onde = `tela "${tela.id}"`;

    if (tela.title && tela.title.length > LIMITES.title) {
      aviso(onde, `title com ${tela.title.length} caracteres (máx ${LIMITES.title})`);
    }

    const form = (tela.layout.children || []).find(c => c.type === 'Form');
    if (!form) { aviso(onde, 'sem componente Form'); continue; }

    const campos = componentes(form);
    const porNome = {};
    campos.forEach(c => { porNome[c.name] = c; });

    // Limites de texto
    for (const c of form.children || []) {
      for (const [chave, lim] of Object.entries(LIMITES)) {
        if (chave === 'title') continue;
        const v = c[chave];
        if (typeof v === 'string' && v.length > lim) {
          aviso(`${onde} · ${c.name || c.type}`,
                `${chave} com ${v.length} caracteres (máx ${lim}) — "${v.slice(0, 40)}…"`);
        }
      }
      // Regra 6: Dropdown com valor inicial.
      //
      // Não é recusa da Meta — é decisão deste projeto, e nasceu de um erro
      // real: o formulário de oferta pré-selecionava a primeira comunidade da
      // lista para quem não tinha nenhuma. É a comunidade que decide para onde
      // o dinheiro vai, e um campo já preenchido convida a passar batido.
      //
      // Um Dropdown que escolhe sozinho não é conveniência: é uma resposta que
      // o sistema deu no lugar da pessoa.
      if (c.type === 'Dropdown' && c.name && (form['init-values'] || {})[c.name] !== undefined) {
        aviso(`${onde} · ${c.name}`,
              'Dropdown com valor inicial — deixe a pessoa escolher ' +
              '(regra do projeto, não da Meta)');
      }

      // Regra 5: propriedade que não vale para aquele componente.
      for (const prop of PROIBIDO_POR_COMPONENTE[c.type] || []) {
        if (prop in c) {
          aviso(`${onde} · ${c.name || c.type}`,
                `'${prop}' não é permitido em '${c.type}'`);
        }
      }

      // Valor inicial pertence ao Form, não ao componente.
      if ('init-value' in c) {
        aviso(`${onde} · ${c.name || c.type}`,
              "usa 'init-value' no componente; mova para 'init-values' no Form");
      }

      // `${...}` só resolve quando é o valor INTEIRO. Dentro de uma frase
      // maior ele aparece literal na tela do aparelho — e o Flow Builder
      // aceita sem reclamar, então só se descobre olhando o formulário.
      for (const chave of ['text', 'label', 'helper-text']) {
        const v = c[chave];
        if (typeof v === 'string' && /\$\{/.test(v) && !/^\$\{[^}]+\}$/.test(v)) {
          aviso(`${onde} · ${c.name || c.type}`,
                `${chave} mistura texto com \${...}: "${v.slice(0, 44)}". ` +
                `O binding só resolve a string inteira — ponha o texto fixo dentro do dado.`);
        }
      }
    }

    // init-values: nome existe e TIPO bate com o input-type do campo
    for (const [nome, ref] of Object.entries(form['init-values'] || {})) {
      const campo = porNome[nome];
      if (!campo) { aviso(onde, `init-values aponta para "${nome}", que não é campo do Form`); continue; }

      const m = /^\$\{data\.([\w-]+)\}$/.exec(String(ref));
      if (!m) continue;                       // valor literal: a Meta confere sozinha

      const esquema = (tela.data || {})[m[1]];
      if (!esquema) { aviso(onde, `init-values usa data.${m[1]}, que não está declarado`); continue; }

      const esperado = campo['input-type'] === 'number' ? 'number' : 'string';
      if (esquema.type !== esperado) {
        aviso(onde, `"${nome}" é input-type=${campo['input-type'] || 'text'}, ` +
                    `então data.${m[1]} precisa ser '${esperado}' e está '${esquema.type}'`);
      }
      if (typeof esquema.__example__ !== esperado) {
        aviso(onde, `data.${m[1]}.__example__ deveria ser ${esperado} e é ` +
                    `${typeof esquema.__example__} (${JSON.stringify(esquema.__example__)})`);
      }
    }

    // O payload do Footer deve citar campos que existem
    const rodape = (form.children || []).find(c => c.type === 'Footer');
    const payload = rodape && rodape['on-click-action'] && rodape['on-click-action'].payload;
    for (const [chave, ref] of Object.entries(payload || {})) {
      const m = /^\$\{form\.([\w-]+)\}$/.exec(String(ref));
      if (m && !porNome[m[1]]) {
        aviso(onde, `payload manda "${chave}" de form.${m[1]}, que não é campo do Form`);
      }
    }
  }

  return problemas;
}

const alvos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(__dirname).filter(f => /^flow-.*\.json$/.test(f)).map(f => path.join(__dirname, f));

let total = 0;
for (const arquivo of alvos) {
  const problemas = validar(arquivo);
  total += problemas.length;
  console.log(`\n${path.basename(arquivo)}`);
  if (!problemas.length) console.log('  ✅ passou nas regras conhecidas');
  else problemas.forEach(p => console.log(`  ❌ ${p}`));
}

console.log(total ? `\n${total} problema(s).` : '\nTudo certo — pode colar no Flow Builder.');
process.exit(total ? 1 : 0);
