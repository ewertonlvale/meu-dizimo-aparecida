/**
 * ============================================================================
 * SETUPCAMPOSOFERTA.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * BL-41 — prepara o Odoo para registrar OFERTA além de dízimo.
 *
 * São três mudanças, e elas NÃO têm o mesmo risco. Rode nesta ordem:
 *
 *   1. conferirMigracaoOferta()      ← só LÊ. Comece sempre por aqui.
 *   2. criarCamposOferta()           ← acrescenta 2 campos novos. Seguro.
 *   3. tornarComunidadeGravavel()    ← ⚠️ ALTERA UM CAMPO COM DADOS.
 *   4. backfillTipoContribuicao()    ← marca os registros antigos como Dízimo.
 *
 * POR QUE O PASSO 3 EXISTE
 *   `x_devolucao.x_studio_comunidade` é hoje `related` a
 *   `x_studio_dizimista.x_studio_comunidade`, stored e readonly — ou seja, a
 *   comunidade é espelhada do dizimista e o bot nunca a grava.
 *
 *   Oferta não exige cadastro. Sem dizimista, o registro cairia sem comunidade
 *   — e é a comunidade que diz para qual conta o dinheiro foi, e por onde os
 *   relatórios do coordenador filtram. Uma oferta sem comunidade é uma linha
 *   que ninguém concilia.
 *
 *   Foram avaliadas três saídas (ver BL-41 no BACKLOG). A escolhida foi tornar
 *   o campo gravável: é o modelo honesto — a oferta TEM comunidade, ela só não
 *   chega por uma pessoa — e só existem dois pontos de escrita a ajustar.
 *
 * ⚠️ O PASSO 3 É O ÚNICO IRREVERSÍVEL POR AQUI
 *   Remover o `related` de um campo stored deveria preservar a coluna e os
 *   valores já gravados. "Deveria" não é "verifica-se sozinho": o passo 1
 *   mostra quantos registros têm comunidade hoje, e vale conferir o mesmo
 *   número depois. Faça isto enquanto os dados ainda forem de teste.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

/** Campos que o BL-41 acrescenta, na ordem em que aparecem no relatório. */
const CAMPOS_OFERTA = [
  {
    model: 'x_devolucao',
    name:  'x_studio_tipo_contribuicao',
    label: 'Tipo de Contribuição',
    ttype: 'selection',
    opcoes: [['dizimo', 'Dízimo'], ['oferta', 'Oferta']]
  },
  {
    model: 'x_devolucao',
    name:  'x_studio_telefone_ofertante',
    label: 'Telefone do Ofertante',
    ttype: 'char'
  },
  {
    // Acrescentado em 19/09: a oferta passou a pedir o nome de quem oferta.
    // Sem ele, uma oferta de não cadastrado chegava à secretaria como um
    // telefone solto. `criarCamposOferta()` é idempotente — rodar de novo só
    // cria o que falta.
    model: 'x_devolucao',
    name:  'x_studio_nome_ofertante',
    label: 'Nome do Ofertante',
    ttype: 'char'
  }
];

// ============================================================================
// PASSO 1 — CONFERÊNCIA (só leitura)
// ============================================================================

/**
 * Mostra o estado atual e o que cada passo faria. **Não grava nada.**
 * Rode antes e depois do passo 3, e compare os números.
 */
function conferirMigracaoOferta() {
  Logger.log('\n🔎 CONFERÊNCIA DA MIGRAÇÃO DO BL-41 — nada será gravado');
  Logger.log('═'.repeat(64));

  // ── Os campos novos ───────────────────────────────────────────────────────
  Logger.log('\n▸ PASSO 2 — campos a criar');
  CAMPOS_OFERTA.forEach(c => {
    const existe = _campoOdoo(c.model, c.name);
    Logger.log(existe
      ? `   ✅ ${c.name} já existe (id=${existe.id}) — nada a fazer`
      : `   ➕ ${c.name} (${c.ttype}) seria CRIADO`);
  });

  // ── O campo de risco ──────────────────────────────────────────────────────
  Logger.log('\n▸ PASSO 3 — x_studio_comunidade');
  const campo = _campoOdoo('x_devolucao', 'x_studio_comunidade');
  if (!campo) {
    Logger.log('   ❌ Campo não encontrado. Confira o modelo antes de seguir.');
    return;
  }

  Logger.log(`   id=${campo.id}  related=${campo.related || '(nenhum)'}  ` +
             `readonly=${campo.readonly}  store=${campo.store}`);

  if (!campo.related) {
    Logger.log('   ✅ Já é gravável — passo 3 não precisa rodar.');
  } else {
    Logger.log(`   ⚠️ Passaria de "espelho de ${campo.related}" para campo gravável.`);
  }

  // ── A medida que importa: quantos registros têm comunidade HOJE ───────────
  // É este número que precisa continuar igual depois do passo 3. Se cair, os
  // valores não sobreviveram e é preciso restaurar antes de seguir.
  Logger.log('\n▸ MEDIDA DE CONTROLE — anote e confira depois');
  try {
    const total = OdooService.count('x_devolucao', []);
    const comCom = OdooService.count('x_devolucao', [['x_studio_comunidade', '!=', false]]);
    Logger.log(`   Devoluções no total:        ${total}`);
    Logger.log(`   …com comunidade preenchida: ${comCom}`);
    Logger.log('   👉 Depois do passo 3, o segundo número tem de ser o MESMO.');
  } catch (e) {
    Logger.log(`   ⚠️ Não consegui contar: ${e.message}`);
  }

  // ── Backfill ──────────────────────────────────────────────────────────────
  Logger.log('\n▸ PASSO 4 — backfill do tipo de contribuição');
  if (!_campoOdoo('x_devolucao', 'x_studio_tipo_contribuicao')) {
    Logger.log('   ⏳ Depende do passo 2.');
  } else {
    try {
      const semTipo = OdooService.count('x_devolucao',
        [['x_studio_tipo_contribuicao', '=', false]]);
      Logger.log(`   ${semTipo} registro(s) seriam marcados como 'dizimo'.`);
    } catch (e) {
      Logger.log(`   ⚠️ Não consegui contar: ${e.message}`);
    }
  }

  Logger.log('\n' + '═'.repeat(64));
  Logger.log('Nada foi alterado. Rode os passos 2, 3 e 4 quando quiser aplicar.');
}

// ============================================================================
// PASSO 2 — CAMPOS NOVOS (seguro, idempotente)
// ============================================================================

/** Cria os campos do BL-41. Pode rodar de novo sem risco. */
function criarCamposOferta() {
  Logger.log('\n➕ [SetupOferta] Criando campos…');

  CAMPOS_OFERTA.forEach(spec => {
    if (_campoOdoo(spec.model, spec.name)) {
      Logger.log(`ℹ️ ${spec.name} já existe — pulando.`);
      return;
    }

    const modelos = OdooService.searchRead('ir.model', ['id'], [['model', '=', spec.model]], { limit: 1 });
    if (!modelos || !modelos.length) {
      Logger.log(`❌ Modelo ${spec.model} não encontrado.`);
      return;
    }

    const payload = {
      name:              spec.name,
      field_description: spec.label,
      model:             spec.model,
      model_id:          modelos[0].id,
      ttype:             spec.ttype,
      state:             'manual'
    };

    // Selection no Odoo moderno usa `selection_ids` (one2many), com os comandos
    // (0, 0, {...}) para criar as opções junto do campo.
    if (spec.ttype === 'selection') {
      payload.selection_ids = spec.opcoes.map((op, i) => [0, 0, {
        value: op[0], name: op[1], sequence: (i + 1) * 10
      }]);
    }

    try {
      const id = OdooService.create('ir.model.fields', payload);
      Logger.log(`✅ ${spec.name} criado (id=${id}).`);
    } catch (e) {
      Logger.log(`❌ Falha ao criar ${spec.name}: ${e.message}`);
      Logger.log('   Se a versão do seu Odoo recusar `selection_ids`, crie o campo');
      Logger.log('   pelo Studio com as opções "dizimo" e "oferta" — o bot grava o');
      Logger.log('   valor técnico, não o rótulo.');
    }
  });

  Logger.log('➕ [SetupOferta] Fim.');
}

// ============================================================================
// PASSO 3 — ⚠️ TORNAR A COMUNIDADE GRAVÁVEL
// ============================================================================

/**
 * ⚠️ ALTERA UM CAMPO QUE JÁ TEM DADOS.
 *
 * Rode `conferirMigracaoOferta()` antes, anote quantas devoluções têm
 * comunidade, e confira o mesmo número depois. Exige `MODO_TESTE = 'true'`
 * nas Script Properties — é a mesma trava das demais funções destrutivas
 * deste projeto, e existe para que isto não rode por engano em produção.
 */
function tornarComunidadeGravavel() {
  const modoTeste = Plataforma.propriedades.getProperty('MODO_TESTE');
  if (modoTeste !== 'true') {
    Logger.log('🔒 Bloqueado: defina MODO_TESTE = "true" nas Script Properties.');
    Logger.log('   Esta função altera um campo com dados gravados.');
    return;
  }

  const campo = _campoOdoo('x_devolucao', 'x_studio_comunidade');
  if (!campo) return Logger.log('❌ Campo não encontrado.');

  if (!campo.related) {
    return Logger.log('✅ Já é gravável. Nada a fazer.');
  }

  let antes = null;
  try {
    antes = OdooService.count('x_devolucao', [['x_studio_comunidade', '!=', false]]);
    Logger.log(`📏 Antes: ${antes} devolução(ões) com comunidade.`);
  } catch (e) {
    Logger.log(`⚠️ Não consegui medir antes (${e.message}). Prosseguindo assim mesmo é arriscado — pare aqui se puder.`);
  }

  try {
    // `readonly` é consequência do `related`; os dois saem juntos, senão o
    // campo fica gravável pela API e bloqueado na tela.
    OdooService.write('ir.model.fields', campo.id, { related: false, readonly: false });
    Logger.log('✅ Campo alterado.');
  } catch (e) {
    return Logger.log(`❌ Falhou: ${e.message}`);
  }

  try {
    const depois = OdooService.count('x_devolucao', [['x_studio_comunidade', '!=', false]]);
    Logger.log(`📏 Depois: ${depois} devolução(ões) com comunidade.`);
    if (antes !== null && depois !== antes) {
      Logger.log(`🚨 DIVERGÊNCIA: eram ${antes}, agora são ${depois}.`);
      Logger.log('   Os valores NÃO sobreviveram. Restaure antes de usar o bot,');
      Logger.log('   ou repopule a comunidade a partir do dizimista de cada registro.');
    } else {
      Logger.log('✅ Contagem preservada.');
    }
  } catch (e) {
    Logger.log(`⚠️ Não consegui medir depois: ${e.message}`);
  }
}

// ============================================================================
// PASSO 4 — BACKFILL
// ============================================================================

/**
 * Marca como 'dizimo' toda devolução sem tipo. Sem isto, os registros antigos
 * ficam nulos e somem dos relatórios assim que o filtro por tipo entrar.
 * Idempotente: roda quantas vezes quiser.
 */
function backfillTipoContribuicao() {
  if (!_campoOdoo('x_devolucao', 'x_studio_tipo_contribuicao')) {
    return Logger.log('❌ Campo não existe. Rode criarCamposOferta() antes.');
  }

  const LOTE = 200;
  let total = 0;

  for (let volta = 0; volta < 50; volta++) {
    const pendentes = OdooService.searchRead(
      'x_devolucao', ['id'],
      [['x_studio_tipo_contribuicao', '=', false]],
      { limit: LOTE }
    );
    if (!pendentes || !pendentes.length) break;

    pendentes.forEach(r => {
      try {
        OdooService.write('x_devolucao', r.id, { x_studio_tipo_contribuicao: 'dizimo' });
        total++;
      } catch (e) {
        Logger.log(`⚠️ id=${r.id}: ${e.message}`);
      }
    });
    Logger.log(`… ${total} marcado(s)`);
  }

  Logger.log(`✅ Backfill concluído: ${total} registro(s) marcados como 'dizimo'.`);
}

// ============================================================================

/**
 * Lê a definição de um campo no `ir.model.fields`, ou null.
 * @private
 */
function _campoOdoo(model, name) {
  try {
    const regs = OdooService.searchRead(
      'ir.model.fields',
      ['id', 'name', 'ttype', 'related', 'readonly', 'store'],
      [['model', '=', model], ['name', '=', name]],
      { limit: 1 }
    );
    return (regs && regs[0]) || null;
  } catch (e) {
    Logger.log(`⚠️ Erro ao ler ${model}.${name}: ${e.message}`);
    return null;
  }
}


// ============================================================================
// PÓS-MIGRAÇÃO — quem não consegue mais devolver
// ============================================================================

/**
 * Lista dizimistas SEM comunidade. Só lê.
 *
 * POR QUE ISTO PASSOU A IMPORTAR DEPOIS DA MIGRAÇÃO.
 * Antes, `x_studio_comunidade` era espelho do dizimista: sem comunidade, a
 * devolução era gravada assim mesmo, com o campo vazio — e ninguém percebia.
 * Agora `registrarDevolucao` EXIGE a comunidade e lança erro, justamente para
 * a linha órfã não existir.
 *
 * O efeito colateral é que um dizimista sem comunidade no cadastro **não
 * consegue mais devolver pelo bot**: ele paga, manda o comprovante e recebe
 * "não consegui registrar sua devolução agora". A falha é honesta — melhor que
 * gravar um registro que ninguém concilia —, mas é melhor ainda descobrir
 * antes de acontecer com alguém.
 *
 * Rode depois da migração e sempre que importar cadastro de fora.
 */
function conferirDizimistasSemComunidade() {
  Logger.log('\n🔎 Dizimistas sem comunidade — não conseguem devolver pelo bot');
  Logger.log('═'.repeat(64));

  let registros;
  try {
    registros = OdooService.searchRead(
      'x_dizimista',
      ['id', 'x_name', 'x_studio_partner_phone'],
      [['x_studio_comunidade', '=', false], ['x_active', '=', true]],
      { limit: 200 }
    );
  } catch (e) {
    return Logger.log(`❌ Falhei ao consultar: ${e.message}`);
  }

  if (!registros || !registros.length) {
    Logger.log('✅ Nenhum. Todo dizimista ativo tem comunidade.');
    return;
  }

  Logger.log(`⚠️ ${registros.length} dizimista(s) ativo(s) SEM comunidade:`);
  registros.forEach(d => {
    Logger.log(`   • #${d.id} ${d.x_name || '(sem nome)'}` +
               `${d.x_studio_partner_phone ? ' — ' + d.x_studio_partner_phone : ' — sem telefone'}`);
  });
  Logger.log('');
  Logger.log('Cada um deles receberá "não consegui registrar sua devolução" ao');
  Logger.log('tentar devolver. Preencha a comunidade no Odoo antes de divulgar o bot.');
}
