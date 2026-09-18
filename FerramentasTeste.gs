/**
 * ============================================================================
 * FERRAMENTASTESTE.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Geração e limpeza de massa de dados para teste de volume.
 *
 * ⚠️ ESTAS FUNÇÕES ESCREVEM E APAGAM REGISTROS NO ODOO CONFIGURADO.
 *
 * Por isso só rodam quando a Script Property `MODO_TESTE` vale exatamente
 * 'true'. Num ambiente onde essa propriedade não existe elas não fazem nada —
 * é a trava que impede um clique errado de poluir uma base real. O arquivo vai
 * junto no deploy justamente para que a trava viaje com ele.
 *
 * Como usar:
 *   1. Script Properties → criar MODO_TESTE = true
 *   2. Executar → gerarMassaTeste
 *   3. Ao terminar os testes: Executar → limparMassaTeste
 *   4. Apagar a propriedade MODO_TESTE
 *
 * Tudo que é criado leva o prefixo MASSA_PREFIXO no `x_name`, e a limpeza
 * remove exatamente o que casa com esse prefixo — nada além disso.
 */

/** Marca de tudo que estas ferramentas criam. A limpeza depende dela. */
const MASSA_PREFIXO = '[TESTE]';

/**
 * DDI/DDD dos números fictícios usados pelo driver de carga
 * (`ferramentas/simula-carga.js`). Os registros que ele gera entram pelo fluxo
 * real do bot, então nascem sem o prefixo acima — é este número que os
 * identifica. Precisa casar com a constante DDD_TESTE do driver.
 */
const MASSA_DDD_TESTE = '5599';

/** Margem do limite de 6 min por execução do Apps Script. */
const MASSA_TEMPO_LIMITE_MS = 4.5 * 60 * 1000;

/** Quantos IDs por chamada de unlink. */
const MASSA_LOTE_EXCLUSAO = 50;

// ============================================================================
// GERAÇÃO
// ============================================================================

/**
 * Cria dizimistas e devoluções de teste no Odoo.
 *
 * @param {number} qtdDizimistas          - Quantos dizimistas criar (padrão 50)
 * @param {number} devolucoesPorDizimista - Devoluções por dizimista (padrão 2)
 */
function gerarMassaTeste(qtdDizimistas, devolucoesPorDizimista) {
  if (!_exigirModoTeste()) return;

  const total    = qtdDizimistas || 50;
  const porPessoa = devolucoesPorDizimista === undefined ? 2 : devolucoesPorDizimista;
  const inicio   = Date.now();

  Logger.log('━━━━━━ [Massa] Início da geração ━━━━━━');
  Logger.log(`Alvo: ${total} dizimista(s), ${porPessoa} devolução(ões) cada`);

  let comunidades;
  try {
    comunidades = OdooService.listarComunidades();
  } catch (e) {
    Logger.log(`❌ Não consegui listar comunidades: ${e.message}`);
    return;
  }

  if (!comunidades || comunidades.length === 0) {
    Logger.log('❌ Nenhuma comunidade cadastrada — crie ao menos uma antes de gerar massa.');
    return;
  }

  Logger.log(`Distribuindo entre ${comunidades.length} comunidade(s).`);

  let criadosDiz = 0;
  let criadasDev = 0;
  let interrompido = false;

  for (let i = 0; i < total; i++) {
    // O Apps Script derruba a execução aos 6 min. Paramos antes e dizemos de
    // onde continuar, em vez de morrer no meio sem relatório.
    if (Date.now() - inicio > MASSA_TEMPO_LIMITE_MS) {
      interrompido = true;
      break;
    }

    const comunidade = comunidades[i % comunidades.length];
    const seq        = String(i + 1).padStart(4, '0');

    try {
      // BL-39: `criarDizimista` passou a conferir se o telefone já tem cadastro,
      // o que custa um search_read por pessoa e faz esta geração render menos
      // dentro dos 6 min (o limite já é tratado acima, parando e dizendo de
      // onde continuar). Em troca, rodar de novo virou idempotente: os números
      // fictícios são únicos por construção, então a segunda passada só repete
      // o que faltou. Não vale abrir exceção aqui — uma exceção numa ferramenta
      // de teste é o tipo de coisa que acaba copiada para o código de produção.
      const dizimistaId = OdooService.criarDizimista({
        nome:             `${MASSA_PREFIXO} Dizimista ${seq} da Silva`,
        nomeUsual:        `${MASSA_PREFIXO} Dizimista ${seq}`,
        whatsapp:         _telefoneFicticio(i),
        endereco:         `Rua de Teste, ${i + 1} — Bairro Exemplo`,
        dataNascimento:   _dataNascimentoFicticia(i),
        valorMensal:      _valorFicticio(i),
        comunidadeId:     comunidade.id,
        notificacaoAtiva: i % 3 !== 0,          // ~2/3 com notificação ativa
        diaPreferido:     (i % 28) + 1
      });

      if (!dizimistaId) {
        Logger.log(`⚠️ Dizimista ${seq} não retornou id — pulando.`);
        continue;
      }
      criadosDiz++;

      for (let d = 0; d < porPessoa; d++) {
        if (_criarDevolucaoTeste(dizimistaId, i, d)) criadasDev++;
      }

      if (criadosDiz % 25 === 0) {
        Logger.log(`… ${criadosDiz} dizimista(s) e ${criadasDev} devolução(ões) até agora`);
      }

    } catch (e) {
      Logger.log(`⚠️ Falha no dizimista ${seq}: ${e.message}`);
    }
  }

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  Logger.log('━━━━━━ [Massa] Fim ━━━━━━');
  Logger.log(`✅ ${criadosDiz} dizimista(s) e ${criadasDev} devolução(ões) em ${seg}s`);
  if (criadosDiz > 0) {
    Logger.log(`⏱️ Média: ${((Date.now() - inicio) / criadosDiz / 1000).toFixed(2)}s por dizimista`);
  }
  if (interrompido) {
    Logger.log('');
    Logger.log('⚠️ Parei antes do limite de 6 min da execução.');
    Logger.log(`   Rode de novo para continuar — o que já foi criado permanece.`);
  }
  Logger.log('');
  Logger.log('Para remover tudo depois: limparMassaTeste()');

  // Descarrega o contador: gerar massa queima milhares de chamadas ao Odoo, e
  // sem isto elas ficavam invisíveis na cota do BL-25 — que é a mesma cota
  // diária que o bot de verdade usa.
  Utils.registrarConsumoExterno();
}

/**
 * Cria uma devolução de teste. Não passa por `registrarDevolucao` porque aqui
 * queremos volume, não exercitar o fluxo — e assim o `x_name` já nasce com o
 * prefixo, o que torna a limpeza uma busca simples.
 * @private
 */
function _criarDevolucaoTeste(dizimistaId, indiceDizimista, indiceDevolucao) {
  // Espalha as devoluções pelos últimos meses, para os relatórios terem o que mostrar.
  const data = new Date();
  data.setMonth(data.getMonth() - indiceDevolucao);
  const dataOdoo = Utilities.formatDate(data, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const valor    = _valorFicticio(indiceDizimista);

  // x_studio_comunidade NÃO é gravado: é related do dizimista (ver BL-05).
  try {
    return OdooService.create('x_devolucao', {
      x_name:                     `${MASSA_PREFIXO} Devolução de R$ ${valor} - ${dataOdoo}`,
      x_studio_dizimista:         dizimistaId,
      x_studio_data_da_devolucao: dataOdoo,
      x_studio_value:             valor,
      x_studio_status:            indiceDevolucao === 0 ? 'Pendente' : 'Confirmado',
      x_studio_forma_de_pagamento: 'Pix'
    });
  } catch (e) {
    Logger.log(`⚠️ Falha ao criar devolução: ${e.message}`);
    return null;
  }
}

// ============================================================================
// LIMPEZA
// ============================================================================

/**
 * Remove tudo que `gerarMassaTeste` criou — e somente isso, casando pelo
 * prefixo. As devoluções saem antes dos dizimistas, por dependerem deles.
 */
function limparMassaTeste() {
  if (!_exigirModoTeste()) return;

  const inicio = Date.now();
  Logger.log('━━━━━━ [Massa] Início da limpeza ━━━━━━');

  const devolucoes = _apagarPorPrefixo('x_devolucao', 'devolução(ões)');
  const dizimistas = _apagarPorPrefixo('x_dizimista', 'dizimista(s)');

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  Logger.log('━━━━━━ [Massa] Fim ━━━━━━');
  Logger.log(`🗑️ ${devolucoes} devolução(ões) e ${dizimistas} dizimista(s) removidos em ${seg}s`);
  Logger.log('');
  Logger.log('Se o total ficou abaixo do esperado, rode de novo — a execução');
  Logger.log('pode ter parado no limite de tempo.');
}

/**
 * Apaga, em lotes, os registros de um modelo cujo `x_name` começa com o prefixo.
 * @param {string} model  - Modelo do Odoo
 * @param {string} rotulo - Palavra usada no log ("dizimista(s)", "contato(s)")
 * @param {string} [padrao] - Padrão `like` do x_name. Omitido, usa MASSA_PREFIXO.
 * @private
 */
function _apagarPorPrefixo(model, rotulo, padrao) {
  const like    = padrao || `${MASSA_PREFIXO}%`;
  let removidos = 0;
  const inicio  = Date.now();

  while (true) {
    if (Date.now() - inicio > MASSA_TEMPO_LIMITE_MS / 2) {
      Logger.log(`⏱️ [${model}] Parei no limite de tempo com ${removidos} removido(s).`);
      break;
    }

    let registros;
    try {
      registros = OdooService.searchRead(
        model, ['id'], [['x_name', 'like', like]],
        { limit: MASSA_LOTE_EXCLUSAO }
      );
    } catch (e) {
      Logger.log(`❌ [${model}] Erro ao buscar: ${e.message}`);
      break;
    }

    if (!registros || registros.length === 0) break;

    const ids = registros.map(r => r.id);
    try {
      OdooService.unlink(model, ids);
      removidos += ids.length;
      Logger.log(`   … ${removidos} ${rotulo}`);
    } catch (e) {
      Logger.log(`❌ [${model}] Erro ao apagar lote: ${e.message}`);
      break;
    }
  }

  return removidos;
}

/**
 * Remove os `x_contato_bot` criados pelo driver de carga.
 *
 * Existe separado porque o driver NÃO passa por `gerarMassaTeste`: ele entra
 * pelo fluxo real do bot, então os registros nascem sem o prefixo `[TESTE]` e
 * escapariam de `limparMassaTeste`. O que os identifica é o DDI/DDD fictício
 * dos números simulados.
 */
function limparContatosTeste() {
  if (!_exigirModoTeste()) return;

  Logger.log('━━━━━━ [Massa] Limpando contatos do driver de carga ━━━━━━');

  // O que muda em relação à massa é só o modelo e o padrão de busca. A
  // paginação por lote e o corte de tempo — a parte sutil, que existe por causa
  // do teto de 6 min do Apps Script — ficam num lugar só: duas cópias de um
  // laço que APAGA registros no Odoo é onde um ajuste feito pela metade custa
  // caro.
  const removidos = _apagarPorPrefixo('x_contato_bot', 'contato(s)', `${MASSA_DDD_TESTE}%`);

  Logger.log(`🗑️ ${removidos} contato(s) de teste removido(s).`);
}

/**
 * Zera o ambiente para começar um teste do início: massa no Odoo, contatos do
 * driver e — o que faltava — o ESTADO EM CACHE dos números fictícios.
 *
 * Sem limpar o cache, um segundo teste começa sujo: `contato_<numero>` ainda
 * diz que o número é conhecido (TTL de 6 h), então não há primeiro contato, e
 * `estado_`/`dados_` retomam o cadastro no meio em vez de começar do zero.
 *
 * @param {number} [usuariosTeto] - Quantos números do modo teto limpar (padrão 100)
 */
function resetarAmbienteTeste(usuariosTeto) {
  if (!_exigirModoTeste()) return;

  Logger.log('━━━━━━ [Massa] RESET do ambiente de teste ━━━━━━');

  _limparCacheNumerosTeste(usuariosTeto || 100);
  limparMassaTeste();
  limparContatosTeste();

  Logger.log('');
  Logger.log('✅ Ambiente zerado. Rode contarMassaTeste() para confirmar.');
}

/**
 * Remove do cache (e das propriedades) o rastro dos números fictícios.
 * O CacheService não lista chaves, mas aqui sabemos exatamente quais números o
 * driver usa, então montamos as chaves em vez de varrer.
 * @private
 */
function _limparCacheNumerosTeste(usuariosTeto) {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();

  // Precisa espelhar o driver: corrida usa 900000001, teto usa 900000100 + i.
  const numeros = [`${MASSA_DDD_TESTE}900000001`];
  for (let i = 0; i < usuariosTeto; i++) {
    numeros.push(`${MASSA_DDD_TESTE}${900000100 + i}`);
  }

  const prefixos = [
    'estado_', 'dados_', 'contato_', 'log_cadastro_',
    'sessao_inicio_', 'aviso_sessao_',
    'tentativas_relatorio_', 'bloqueio_relatorio_'
  ];

  const chaves = [];
  numeros.forEach(n => prefixos.forEach(p => chaves.push(p + n)));

  try {
    cache.removeAll(chaves);
    numeros.forEach(n => props.deleteProperty(`${StateManager.PREFIXO_SESSAO}${n}`));
    Logger.log(`🧹 Cache limpo para ${numeros.length} número(s) de teste.`);
  } catch (e) {
    Logger.log(`⚠️ Erro ao limpar cache: ${e.message}`);
  }
}

/**
 * Conta a massa de teste existente, sem alterar nada.
 * Seguro de rodar a qualquer momento — não exige MODO_TESTE.
 */
function contarMassaTeste() {
  try {
    const dizimistas = OdooService.count('x_dizimista',   [['x_name', 'like', `${MASSA_PREFIXO}%`]]);
    const devolucoes = OdooService.count('x_devolucao',   [['x_name', 'like', `${MASSA_PREFIXO}%`]]);
    const contatos   = OdooService.count('x_contato_bot', [['x_name', 'like', `${MASSA_DDD_TESTE}%`]]);

    Logger.log('');
    Logger.log('📊 Massa de teste no Odoo:');
    Logger.log(`   ${dizimistas} dizimista(s)        (prefixo ${MASSA_PREFIXO})`);
    Logger.log(`   ${devolucoes} devolução(ões)      (prefixo ${MASSA_PREFIXO})`);
    Logger.log(`   ${contatos} contato(s) do driver  (números ${MASSA_DDD_TESTE}…)`);
    Logger.log('');
  } catch (e) {
    Logger.log(`❌ Erro ao contar: ${e.message}`);
  }
}

// ============================================================================
// AUXILIARES
// ============================================================================

/**
 * Trava de segurança: sem MODO_TESTE = 'true' nada é criado nem apagado.
 * @private
 */
function _exigirModoTeste() {
  const modo = PropertiesService.getScriptProperties().getProperty('MODO_TESTE');
  if (modo === 'true') return true;

  Logger.log('');
  Logger.log('🚫 MODO_TESTE não está ativo — nada foi feito.');
  Logger.log('');
  Logger.log('   Estas funções criam e apagam registros no Odoo. Para liberá-las,');
  Logger.log('   crie a Script Property MODO_TESTE com o valor true — e apague-a');
  Logger.log('   quando terminar.');
  Logger.log('');
  return false;
}

/** Número fictício em faixa que não corresponde a linha real. @private */
function _telefoneFicticio(i) {
  return `${MASSA_DDD_TESTE}${100000000 + i}`;
}

/** @private */
function _dataNascimentoFicticia(i) {
  const dia = (i % 28) + 1;
  const mes = (i % 12) + 1;
  const ano = 1960 + (i % 45);
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
}

/** @private */
function _valorFicticio(i) {
  return [20, 30, 50, 75, 100, 150, 200][i % 7];
}
