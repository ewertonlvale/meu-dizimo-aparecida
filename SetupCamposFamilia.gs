/**
 * ============================================================================
 * SETUPCAMPOSFAMILIA.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Cria, via API do Odoo (ir.model.fields), os campos necessários para a
 * funcionalidade de FAMÍLIA. Alternativa ao Odoo Studio.
 *
 * Como usar (uma única vez, no editor do Apps Script):
 *   Executar → criarCamposFamilia
 *   Acompanhe os logs [SetupFamilia].
 *
 * É IDEMPOTENTE: se o campo já existir, não faz nada. Pode rodar de novo sem risco.
 *
 * ⚠️ Isto altera o SCHEMA do seu Odoo de produção (adiciona colunas). É seguro
 * e reversível (dá para apagar o campo no Studio depois), mas é uma mudança real.
 *
 * Depois de rodar, você pode apagar este arquivo do projeto — é só setup.
 */

function criarCamposFamilia() {
  console.log('━━━━━━ [SetupFamilia] Início ━━━━━━');

  // Campo do vínculo da família (Fase 0 — necessário).
  _criarCampoOdoo({
    model:     'x_dizimista',
    name:      'x_studio_responsavel',
    label:     'Responsável',
    ttype:     'many2one',
    relation:  'x_dizimista'
  });

  // Opcional (Fase 2) — agrupa as N devoluções de um mesmo pagamento.
  // Descomente para criar já:
  // _criarCampoOdoo({
  //   model: 'x_devolucao',
  //   name:  'x_studio_grupo_pagamento',
  //   label: 'Grupo de Pagamento',
  //   ttype: 'char'
  // });

  console.log('━━━━━━ [SetupFamilia] Fim ━━━━━━');
}

/**
 * Cria um campo customizado (state=manual) num modelo do Odoo, se ainda não existir.
 * @param {Object} spec - { model, name, label, ttype, relation? }
 * @private
 */
function _criarCampoOdoo(spec) {
  const { model, name, label, ttype, relation } = spec;

  // 1) Localizar o ir.model do modelo alvo.
  let modelId;
  try {
    const modelos = OdooService.searchRead('ir.model', ['id', 'model'], [['model', '=', model]], { limit: 1 });
    if (!modelos || modelos.length === 0) {
      console.error(`❌ [SetupFamilia] Modelo '${model}' não encontrado no Odoo.`);
      return;
    }
    modelId = modelos[0].id;
  } catch (e) {
    console.error(`❌ [SetupFamilia] Erro ao buscar o modelo '${model}': ${e.message}`);
    return;
  }

  // 2) Já existe o campo? (idempotência)
  try {
    const existentes = OdooService.searchRead(
      'ir.model.fields',
      ['id', 'name', 'ttype'],
      [['model', '=', model], ['name', '=', name]],
      { limit: 1 }
    );
    if (existentes && existentes.length > 0) {
      console.log(`ℹ️ [SetupFamilia] Campo ${model}.${name} já existe (id=${existentes[0].id}, ttype=${existentes[0].ttype}). Nada a fazer.`);
      return;
    }
  } catch (e) {
    console.error(`❌ [SetupFamilia] Erro ao verificar existência de ${model}.${name}: ${e.message}`);
    return;
  }

  // 3) Criar o campo (state=manual cria a coluna de verdade).
  const payload = {
    name:              name,
    field_description: label,
    model:             model,
    model_id:          modelId,
    ttype:             ttype,
    state:             'manual'
  };
  if (ttype === 'many2one') {
    payload.relation = relation;   // on_delete não informado → Odoo assume 'set null'
  }

  try {
    const id = OdooService.create('ir.model.fields', payload);
    console.log(`✅ [SetupFamilia] Campo ${model}.${name} criado (id=${id}, ttype=${ttype}${relation ? `, relação=${relation}` : ''}).`);
  } catch (e) {
    console.error(`❌ [SetupFamilia] Falha ao criar ${model}.${name}: ${e.message}`);
    console.error('   Se for erro de permissão, use um usuário Odoo com direito de editar modelos, ou crie o campo pelo Studio.');
  }
}
