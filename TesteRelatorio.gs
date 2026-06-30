/**
 * ============================================================================
 * TESTE_RELATORIO.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Testes para a funcionalidade de Relatório.
 * Execute cada função individualmente pelo menu "Executar" do Apps Script.
 *
 * COMO USAR:
 *   1. Cole este arquivo no projeto do Apps Script
 *   2. Selecione a função desejada no seletor de funções
 *   3. Clique em ▶ Executar
 *   4. Veja os resultados em Visualizar → Registros de execução
 *
 * ⚠️  Estes testes NÃO enviam mensagens pelo WhatsApp.
 *     Usam um número fictício interno para simular o fluxo.
 *
 * Versão: 1.0
 * Data: Fevereiro 2026
 */


// ============================================================================
// NÚMERO DE TESTE
// Substitua pelo número real de um admin cadastrado em x_parametros_line_c498a
// ============================================================================
const NUMERO_ADMIN       = '558688521231';   // ← trocar
const NUMERO_COORDENADOR = '558688521231';   // ← trocar (deve estar em x_comunidade)
const NUMERO_SEM_ACESSO  = '558688521232';   // número que NÃO tem acesso


// ============================================================================
// 1. TESTAR ODOOSERVICE — MÉTODOS DO RELATÓRIO
// ============================================================================

/** Testa buscarNumerosPrivilegiados() */
function testeOdoo_BuscarAdmins() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: buscarNumerosPrivilegiados()');
  console.log('═══════════════════════════════════════');

  try {
    const admins = OdooService.buscarNumerosPrivilegiados();
    console.log(`✅ Retornou ${admins.length} admin(s)`);
    admins.forEach((a, i) => {
      console.log(`  [${i+1}] ${a.x_name} → WhatsApp: ${a.x_studio_whatsapp}`);
    });
  } catch (e) {
    console.error('❌ ERRO:', e.message);
  }
}

/** Testa listarComunidades() — verifica se x_studio_chave_acesso está presente */
function testeOdoo_ListarComunidades() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: listarComunidades()');
  console.log('═══════════════════════════════════════');

  try {
    const comunidades = OdooService.listarComunidades();
    console.log(`✅ Retornou ${comunidades.length} comunidade(s)`);
    comunidades.forEach((c, i) => {
      const temCoord = c.x_studio_chave_acesso ? c.x_studio_chave_acesso : '— sem coordenador';
      console.log(`  [${i+1}] ${c.x_name} | coordenador: ${temCoord}`);
    });

    // Verificação crítica
    const semCampo = comunidades.filter(c => !('x_studio_chave_acesso' in c));
    if (semCampo.length > 0) {
      console.warn('⚠️  ATENÇÃO: x_studio_chave_acesso não retornou em', semCampo.length, 'registro(s)!');
    } else {
      console.log('✅ Campo x_studio_chave_acesso presente em todos os registros');
    }
  } catch (e) {
    console.error('❌ ERRO:', e.message);
  }
}

/** Testa listarTodosDizimistas() */
function testeOdoo_ListarDizimistas() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: listarTodosDizimistas()');
  console.log('═══════════════════════════════════════');

  try {
    const lista = OdooService.listarTodosDizimistas();
    console.log(`✅ Retornou ${lista.length} dizimista(s) ativo(s)`);

    // Amostra dos primeiros 5
    lista.slice(0, 5).forEach((d, i) => {
      const comId = Array.isArray(d.x_studio_comunidade) ? d.x_studio_comunidade[0] : d.x_studio_comunidade;
      console.log(`  [${i+1}] ${d.x_name} | comunidade_id: ${comId} | valor: R$ ${d.x_studio_value}`);
    });
    if (lista.length > 5) console.log(`  ... e mais ${lista.length - 5}`);
  } catch (e) {
    console.error('❌ ERRO:', e.message);
  }
}

/** Testa listarDevolucoesPorPeriodo() — usa mês atual */
function testeOdoo_ListarDevolucoes() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: listarDevolucoesPorPeriodo()');
  console.log('═══════════════════════════════════════');

  const agora = new Date();
  const ano   = agora.getFullYear();
  const mes   = String(agora.getMonth() + 1).padStart(2, '0');
  const inicio = `${ano}-${mes}-01`;
  const fim    = `${ano}-${mes}-${new Date(ano, agora.getMonth() + 1, 0).getDate()}`;

  console.log(`📅 Período: ${inicio} → ${fim}`);

  try {
    const devs = OdooService.listarDevolucoesPorPeriodo(inicio, fim);
    console.log(`✅ Retornou ${devs.length} devolução(ões) no período`);

    devs.slice(0, 5).forEach((d, i) => {
      const dizId = Array.isArray(d.x_studio_dizimista) ? d.x_studio_dizimista[0] : d.x_studio_dizimista;
      console.log(`  [${i+1}] dizimista_id: ${dizId} | valor: R$ ${d.x_studio_value} | data: ${d.x_studio_data_da_devolucao}`);
    });
    if (devs.length > 5) console.log(`  ... e mais ${devs.length - 5}`);
  } catch (e) {
    console.error('❌ ERRO:', e.message);
  }
}

/** Roda todos os 4 testes do OdooService em sequência */
function testeOdoo_Todos() {
  testeOdoo_BuscarAdmins();
  testeOdoo_ListarComunidades();
  testeOdoo_ListarDizimistas();
  testeOdoo_ListarDevolucoes();
  console.log('');
  console.log('✅ Todos os testes Odoo finalizados');
}


// ============================================================================
// 2. TESTAR VERIFICAÇÃO DE ACESSO
// ============================================================================

/** Testa acesso com número de admin */
function testeAcesso_Admin() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: Acesso Admin');
  console.log('Número:', NUMERO_ADMIN);
  console.log('═══════════════════════════════════════');

  const resultado = RelatorioHandler.verificarAcesso(NUMERO_ADMIN);
  console.log('Resultado:', JSON.stringify(resultado, null, 2));

  if (resultado.temAcesso && resultado.tipoAcesso === 'admin') {
    console.log('✅ PASSOU — Admin identificado corretamente');
  } else {
    console.warn('❌ FALHOU — Esperado: { temAcesso: true, tipoAcesso: "admin" }');
    console.warn('   Verifique se o número está cadastrado em x_parametros_line_c498a');
  }
}

/** Testa acesso com número de coordenador */
function testeAcesso_Coordenador() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: Acesso Coordenador');
  console.log('Número:', NUMERO_COORDENADOR);
  console.log('═══════════════════════════════════════');

  const resultado = RelatorioHandler.verificarAcesso(NUMERO_COORDENADOR);
  console.log('Resultado:', JSON.stringify(resultado, null, 2));

  if (resultado.temAcesso && resultado.tipoAcesso === 'coordenador') {
    console.log(`✅ PASSOU — Coordenador de "${resultado.comunidadeNome}" identificado`);
  } else {
    console.warn('❌ FALHOU — Esperado: { temAcesso: true, tipoAcesso: "coordenador" }');
    console.warn('   Verifique se o número está em x_comunidade.x_studio_chave_acesso');
  }
}

/** Testa rejeição de número sem acesso */
function testeAcesso_SemPermissao() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: Acesso Negado');
  console.log('Número:', NUMERO_SEM_ACESSO);
  console.log('═══════════════════════════════════════');

  const resultado = RelatorioHandler.verificarAcesso(NUMERO_SEM_ACESSO);
  console.log('Resultado:', JSON.stringify(resultado, null, 2));

  if (!resultado.temAcesso) {
    console.log('✅ PASSOU — Acesso negado corretamente');
  } else {
    console.warn('❌ FALHOU — Número sem acesso foi autorizado!');
  }
}

/** Testa normalização de formatos de número */
function testeAcesso_FormatosDeNumero() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: Normalização de formatos de número');
  console.log('═══════════════════════════════════════');

  const base = '85999990001';
  const variantes = [
    '5585999990001',
    '85999990001',
    '(85) 99999-0001',
    '+55 85 99999-0001'
  ];

  variantes.forEach(v => {
    const iguais = RelatorioHandler._numerosIguais(base, v);
    console.log(`  "${v}" == "${base}" → ${iguais ? '✅' : '❌'}`);
  });
}

/** Roda todos os testes de acesso */
function testeAcesso_Todos() {
  testeAcesso_Admin();
  testeAcesso_Coordenador();
  testeAcesso_SemPermissao();
  testeAcesso_FormatosDeNumero();
  console.log('');
  console.log('✅ Todos os testes de acesso finalizados');
}


// ============================================================================
// 3. TESTAR CÁLCULO DE PERÍODO
// ============================================================================

function testePeriodo_Calculo() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: _calcularPeriodo()');
  console.log('═══════════════════════════════════════');

  const casos = ['rel_mes_atual', 'rel_mes_passado', 'rel_ano_atual'];

  casos.forEach(id => {
    const p = RelatorioHandler._calcularPeriodo(id);
    if (p) {
      console.log(`✅ ${id}`);
      console.log(`   Início : ${p.dataInicio}`);
      console.log(`   Fim    : ${p.dataFim}`);
      console.log(`   Label  : ${p.label}`);

      // Validar formato ISO
      const reISO = /^\d{4}-\d{2}-\d{2}$/;
      if (!reISO.test(p.dataInicio) || !reISO.test(p.dataFim)) {
        console.warn('   ⚠️ Datas fora do formato YYYY-MM-DD!');
      }
      // Validar que início <= fim
      if (p.dataInicio > p.dataFim) {
        console.warn('   ⚠️ dataInicio é maior que dataFim!');
      }
    } else {
      console.warn(`❌ ${id} → retornou null`);
    }
  });

  // Teste com ID inválido
  const invalido = RelatorioHandler._calcularPeriodo('rel_invalido');
  console.log(`\n  ID inválido → ${invalido === null ? '✅ null (correto)' : '❌ deveria ser null'}`);
}


// ============================================================================
// 4. TESTAR GERAÇÃO DOS BLOCOS (sem enviar WhatsApp)
// ============================================================================

/**
 * Gera o relatório completo com dados reais do Odoo e exibe no console.
 * NÃO envia nenhuma mensagem pelo WhatsApp.
 * Útil para validar o conteúdo antes de testar via WhatsApp.
 */
function testeRelatorio_ConteudoCompleto() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: Conteúdo completo do relatório (sem WhatsApp)');
  console.log('═══════════════════════════════════════');

  // Simular acesso admin
  const acesso = { tipoAcesso: 'admin', comunidadeId: null, comunidadeNome: null };

  // Período: mês atual
  const periodo = RelatorioHandler._calcularPeriodo('rel_mes_atual');
  console.log(`📅 Período: ${periodo.label} (${periodo.dataInicio} → ${periodo.dataFim})\n`);

  try {
    const comunidades = OdooService.listarComunidades();
    const dizimistas  = OdooService.listarTodosDizimistas();
    const devolucoes  = OdooService.listarDevolucoesPorPeriodo(periodo.dataInicio, periodo.dataFim);

    console.log(`📦 Dados carregados:`);
    console.log(`   Comunidades : ${comunidades.length}`);
    console.log(`   Dizimistas  : ${dizimistas.length}`);
    console.log(`   Devoluções  : ${devolucoes.length}`);
    console.log('');

    // Bloco 1
    const b1 = RelatorioHandler._blocoArrecadacao(comunidades, dizimistas, devolucoes);
    console.log('── BLOCO 1: ARRECADAÇÃO ─────────────────');
    console.log(b1);
    console.log('');

    // Bloco 2
    const b2 = RelatorioHandler._blocoNovosCadastros(comunidades, dizimistas, periodo);
    console.log('── BLOCO 2: NOVOS CADASTROS ─────────────');
    console.log(b2);
    console.log('');

    // Bloco 3
    const b3 = RelatorioHandler._blocoEmAtraso(comunidades, dizimistas, devolucoes);
    console.log('── BLOCO 3: EM ATRASO ───────────────────');
    console.log(b3);
    console.log('');

    console.log('✅ Conteúdo gerado com sucesso');
  } catch (e) {
    console.error('❌ ERRO ao gerar conteúdo:', e.message);
    console.error(e.stack);
  }
}

/**
 * Mesma função mas filtrando por coordenador (escopo restrito).
 * Substitua NUMERO_COORDENADOR por um número real antes de executar.
 */
function testeRelatorio_ConteudoCoordenador() {
  console.log('═══════════════════════════════════════');
  console.log('TESTE: Conteúdo do relatório (visão coordenador)');
  console.log('═══════════════════════════════════════');

  const acesso = RelatorioHandler.verificarAcesso(NUMERO_COORDENADOR);

  if (!acesso.temAcesso) {
    console.warn('⚠️ Número não tem acesso. Verifique NUMERO_COORDENADOR no topo do arquivo.');
    return;
  }

  console.log(`👤 Coordenador de: ${acesso.comunidadeNome}\n`);

  const periodo = RelatorioHandler._calcularPeriodo('rel_mes_atual');

  try {
    const todasComunidades = OdooService.listarComunidades();
    const todosDizimistas  = OdooService.listarTodosDizimistas();
    const todasDevolucoes  = OdooService.listarDevolucoesPorPeriodo(periodo.dataInicio, periodo.dataFim);

    // Filtrar por comunidade do coordenador
    const comunidades = todasComunidades.filter(c => c.id === acesso.comunidadeId);
    const dizimistas  = todosDizimistas.filter(d => {
      const cId = Array.isArray(d.x_studio_comunidade) ? d.x_studio_comunidade[0] : d.x_studio_comunidade;
      return cId === acesso.comunidadeId;
    });
    const idsEscopo  = new Set(dizimistas.map(d => d.id));
    const devolucoes = todasDevolucoes.filter(dev => {
      const dId = Array.isArray(dev.x_studio_dizimista) ? dev.x_studio_dizimista[0] : dev.x_studio_dizimista;
      return idsEscopo.has(dId);
    });

    console.log(`📦 Escopo filtrado: ${comunidades.length} comunidade | ${dizimistas.length} dizimistas | ${devolucoes.length} devoluções\n`);

    console.log(RelatorioHandler._blocoArrecadacao(comunidades, dizimistas, devolucoes));
    console.log('');
    console.log(RelatorioHandler._blocoNovosCadastros(comunidades, dizimistas, periodo));
    console.log('');
    console.log(RelatorioHandler._blocoEmAtraso(comunidades, dizimistas, devolucoes));
    console.log('');
    console.log('✅ Teste de coordenador finalizado');
  } catch (e) {
    console.error('❌ ERRO:', e.message);
  }
}


// ============================================================================
// 5. TESTE COMPLETO (SUITE)
// ============================================================================

/**
 * Executa todos os testes em sequência.
 * Ideal para validar tudo antes do deploy.
 */
function testeSuite_Completa() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   SUITE COMPLETA — RELATÓRIO         ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  testeOdoo_Todos();
  console.log('');

  testeAcesso_Todos();
  console.log('');

  testePeriodo_Calculo();
  console.log('');

  testeRelatorio_ConteudoCompleto();
  console.log('');

  console.log('╔══════════════════════════════════════╗');
  console.log('║   SUITE FINALIZADA                   ║');
  console.log('╚══════════════════════════════════════╝');
}

/**
 * ============================================================================
 * TESTE_RELATORIO_WHATSAPP.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Testes que enviam mensagens REAIS pelo WhatsApp para o admin.
 * Use para validar o fluxo completo antes de liberar para usuários.
 *
 * ⚠️  ATENÇÃO: estas funções enviam mensagens de verdade!
 *     Configure NUMERO_ADMIN abaixo antes de executar.
 *
 * COMO USAR:
 *   1. Ajuste NUMERO_ADMIN com o número real do administrador
 *   2. Selecione a função no menu do Apps Script
 *   3. Clique ▶ Executar
 *   4. Confira o WhatsApp do admin para ver as mensagens chegando
 *
 * Versão: 1.0
 * Data: Fevereiro 2026
 */

// ============================================================================
// ⚙️  CONFIGURAÇÃO — ajuste antes de executar
// ============================================================================

/** Número do admin no formato internacional, SEM o @c.us */
const ADMIN_WHATSAPP = '558688521231';  // ← TROCAR pelo número real

/** Número de coordenador para testes de escopo restrito */
const COORD_WHATSAPP = '558688521231';  // ← TROCAR pelo número real


// ============================================================================
// 1. MENSAGENS AVULSAS — validar formatação visual
// ============================================================================

/**
 * Envia o cabeçalho do relatório (Mensagem 1).
 * Use para conferir se o layout está correto no WhatsApp.
 */
function enviarTeste_Cabecalho() {
  _log('TESTE: Cabeçalho do relatório');

  const agora = Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm');

  Utils.enviarSimples(ADMIN_WHATSAPP,
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *RELATÓRIO DE DÍZIMOS*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🗂️ Escopo: 🏛️ Todas as Comunidades\n` +
    `📅 Período: fevereiro de 2026\n` +
    `🕐 Gerado: ${agora}`
  );

  _log('✅ Cabeçalho enviado');
}

/**
 * Envia um bloco de arrecadação com dados fictícios.
 * Use para conferir emojis, alinhamento e formatação de valores.
 */
function enviarTeste_BlocoArrecadacao() {
  _log('TESTE: Bloco de arrecadação (dados fictícios)');

  Utils.enviarSimples(ADMIN_WHATSAPP,
    `💰 *ARRECADAÇÃO POR COMUNIDADE*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🟢 *Nossa Senhora Aparecida*\n` +
    `   💵 Arrecadado: R$ 3.250,00\n` +
    `   🎯 Esperado:    R$ 4.000,00\n` +
    `   📈 Realização:  81%\n\n` +
    `🟡 *São José*\n` +
    `   💵 Arrecadado: R$ 1.800,00\n` +
    `   🎯 Esperado:    R$ 3.500,00\n` +
    `   📈 Realização:  51%\n\n` +
    `🔴 *Santo Antônio*\n` +
    `   💵 Arrecadado: R$ 500,00\n` +
    `   🎯 Esperado:    R$ 2.000,00\n` +
    `   📈 Realização:  25%\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 *TOTAL GERAL*\n` +
    `   💵 Arrecadado: R$ 5.550,00\n` +
    `   🎯 Esperado:    R$ 9.500,00\n` +
    `   📈 Realização:  58%`
  );

  _log('✅ Bloco arrecadação enviado');
}

/**
 * Envia o bloco de novos cadastros com dados fictícios.
 */
function enviarTeste_BlocoNovosCadastros() {
  _log('TESTE: Bloco de novos cadastros (dados fictícios)');

  Utils.enviarSimples(ADMIN_WHATSAPP,
    `🆕 *NOVOS CADASTROS NO PERÍODO*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⛪ *Nossa Senhora Aparecida* (2)\n` +
    `   • Maria Silva\n` +
    `   • João Santos\n\n` +
    `⛪ *São José* (1)\n` +
    `   • Ana Oliveira\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 Total de novos: 3`
  );

  _log('✅ Bloco novos cadastros enviado');
}

/**
 * Envia o bloco de dizimistas em atraso com botões de ação.
 * Valida se os botões "Novo relatório" e "Menu" aparecem corretamente.
 */
function enviarTeste_BlocoEmAtraso() {
  _log('TESTE: Bloco em atraso com botões (dados fictícios)');

  Utils.enviarMenu(ADMIN_WHATSAPP,
    `⚠️ *DIZIMISTAS SEM DEVOLUÇÃO NO PERÍODO*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⛪ *São José* (3 em atraso)\n` +
    `   • Pedro Costa — R$ 200,00/mês\n` +
    `   • Lucia Rocha — R$ 100,00/mês\n` +
    `   • Carlos Lima — R$ 150,00/mês\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 Total em atraso: 3 dizimistas\n` +
    `💸 Valor potencial: R$ 450,00`,
    [
      { id: 'btn_novo_relatorio', title: '📊 Novo relatório' },
      { id: 'btn_menu',           title: '📙 Menu' }
    ]
  );

  _log('✅ Bloco em atraso com botões enviado');
}

/**
 * Envia as 4 mensagens do relatório completo com dados fictícios.
 * Simula exatamente o que o admin verá, mas com dados de exemplo.
 */
function enviarTeste_RelatorioCompletoFicticio() {
  _log('TESTE: Relatório completo com dados fictícios');

  enviarTeste_Cabecalho();
  Utilities.sleep(500);
  enviarTeste_BlocoArrecadacao();
  Utilities.sleep(500);
  enviarTeste_BlocoNovosCadastros();
  Utilities.sleep(500);
  enviarTeste_BlocoEmAtraso();

  _log('✅ Relatório fictício completo enviado (4 mensagens)');
}


// ============================================================================
// 2. MENU DE PERÍODO — validar lista interativa
// ============================================================================

/**
 * Envia o menu de seleção de período para o admin.
 * O admin verá a lista e poderá tocar em uma opção (sem efeito real aqui).
 */
function enviarTeste_MenuPeriodo() {
  _log('TESTE: Menu de período (lista interativa)');

  const agora = new Date();
  const nomeMes = ['janeiro','fevereiro','março','abril','maio','junho',
                   'julho','agosto','setembro','outubro','novembro','dezembro'];
  const mesAtual = nomeMes[agora.getMonth()] + '/' + agora.getFullYear();
  const mesAnteriorIdx = agora.getMonth() === 0 ? 11 : agora.getMonth() - 1;
  const anoMesAnterior = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear();
  const mesPassado = nomeMes[mesAnteriorIdx] + '/' + anoMesAnterior;

  Utils.enviarLista(ADMIN_WHATSAPP,
    `📊 *RELATÓRIO DE DÍZIMOS*\n\n` +
    `🗂️ Escopo: 🏛️ Todas as comunidades\n\n` +
    `Selecione o período desejado:`,
    [{
      title: 'Selecione o período',
      rows: [
        { id: 'rel_mes_atual',   title: '📅 Mês atual',   description: mesAtual },
        { id: 'rel_mes_passado', title: '📅 Mês passado', description: mesPassado },
        { id: 'rel_ano_atual',   title: '📆 Ano atual',   description: String(agora.getFullYear()) }
      ]
    }]
  );

  _log('✅ Menu de período enviado');
}

/**
 * Envia a mensagem de acesso negado.
 * Útil para confirmar o texto antes de chegar a um usuário real.
 */
function enviarTeste_AcessoNegado() {
  _log('TESTE: Mensagem de acesso negado');

  Utils.enviarSimples(ADMIN_WHATSAPP,
    `⛔ *Acesso restrito*\n\n` +
    `Esta funcionalidade é exclusiva para administradores e coordenadores de comunidade.\n\n` +
    `Se precisar de acesso, entre em contato com a secretaria. 🙏`
  );

  _log('✅ Mensagem de acesso negado enviada');
}


// ============================================================================
// 3. RELATÓRIO COM DADOS REAIS DO ODOO
// ============================================================================

/**
 * Gera e envia o relatório completo com dados REAIS do Odoo — mês atual.
 * Este é o teste de integração completo: Odoo + WhatsApp.
 */
function enviarTeste_RelatorioRealMesAtual() {
  _log('TESTE: Relatório REAL — mês atual → ' + ADMIN_WHATSAPP);

  try {
    const acesso = {
      tipoAcesso: 'admin',
      comunidadeId: null,
      comunidadeNome: null
    };
    const periodo = RelatorioHandler._calcularPeriodo('rel_mes_atual');

    _log(`Período: ${periodo.label} (${periodo.dataInicio} → ${periodo.dataFim})`);

    RelatorioHandler._gerarRelatorio(ADMIN_WHATSAPP, acesso, periodo);

    _log('✅ Relatório real enviado com sucesso!');
  } catch (e) {
    _log('❌ ERRO: ' + e.message);
    console.error(e.stack);
  }
}

/**
 * Gera e envia o relatório completo com dados REAIS do Odoo — mês passado.
 */
function enviarTeste_RelatorioRealMesPassado() {
  _log('TESTE: Relatório REAL — mês passado → ' + ADMIN_WHATSAPP);

  try {
    const acesso = {
      tipoAcesso: 'admin',
      comunidadeId: null,
      comunidadeNome: null
    };
    const periodo = RelatorioHandler._calcularPeriodo('rel_mes_passado');

    _log(`Período: ${periodo.label} (${periodo.dataInicio} → ${periodo.dataFim})`);

    RelatorioHandler._gerarRelatorio(ADMIN_WHATSAPP, acesso, periodo);

    _log('✅ Relatório real enviado com sucesso!');
  } catch (e) {
    _log('❌ ERRO: ' + e.message);
    console.error(e.stack);
  }
}

/**
 * Gera e envia o relatório com dados REAIS, mas com escopo de coordenador.
 * Útil para verificar o filtro por comunidade.
 * ⚠️  Requer que COORD_WHATSAPP esteja cadastrado em x_comunidade.x_studio_chave_acesso
 */
function enviarTeste_RelatorioRealCoordenador() {
  _log('TESTE: Relatório REAL — visão coordenador → ' + COORD_WHATSAPP);

  try {
    const acesso = RelatorioHandler.verificarAcesso(COORD_WHATSAPP);

    if (!acesso.temAcesso || acesso.tipoAcesso !== 'coordenador') {
      _log('⚠️  COORD_WHATSAPP não está cadastrado como coordenador.');
      _log('    Cadastre o número em x_comunidade.x_studio_chave_acesso e tente novamente.');
      Utils.enviarSimples(ADMIN_WHATSAPP,
        `⚠️ *Teste coordenador*\n\nNúmero ${COORD_WHATSAPP} não encontrado como coordenador.\n\nCadastre em x_comunidade.x_studio_chave_acesso e repita o teste.`
      );
      return;
    }

    _log(`Coordenador de: ${acesso.comunidadeNome}`);

    const periodo = RelatorioHandler._calcularPeriodo('rel_mes_atual');
    RelatorioHandler._gerarRelatorio(COORD_WHATSAPP, acesso, periodo);

    _log('✅ Relatório coordenador enviado com sucesso!');
  } catch (e) {
    _log('❌ ERRO: ' + e.message);
    console.error(e.stack);
  }
}


// ============================================================================
// 4. TESTE DO FLUXO COMPLETO (simula o caminho real do usuário)
// ============================================================================

/**
 * Simula exatamente o que acontece quando o admin digita "relatório":
 *   1. Verifica acesso no Odoo
 *   2. Envia menu de período para o admin
 *   3. Simula a escolha do mês atual
 *   4. Gera e envia o relatório completo
 *
 * Este teste percorre TODO o código do RelatorioHandler de ponta a ponta.
 */
function enviarTeste_FluxoCompletoAdmin() {
  _log('═══════════════════════════════════════');
  _log('TESTE: Fluxo completo — admin');
  _log('Número: ' + ADMIN_WHATSAPP);
  _log('═══════════════════════════════════════');

  try {
    // Passo 1: iniciar (verifica acesso + envia menu de período)
    _log('Passo 1: Iniciando fluxo (verificando acesso)...');
    RelatorioHandler.iniciar(ADMIN_WHATSAPP);

    const acesso = StateManager.getCampo(ADMIN_WHATSAPP, 'relatorio_acesso');
    if (!acesso) {
      _log('❌ Acesso não concedido. Verifique se ' + ADMIN_WHATSAPP + ' está em x_parametros_line_c498a');
      return;
    }
    _log(`✅ Acesso: ${acesso.tipoAcesso}`);

    // Passo 2: aguardar um momento (simula o admin tocando na opção)
    Utilities.sleep(1000);

    // Passo 3: processar período (como se o admin tivesse escolhido "mês atual")
    _log('Passo 2: Processando período selecionado (mês atual)...');
    RelatorioHandler.processarPeriodo(ADMIN_WHATSAPP, 'rel_mes_atual');

    _log('✅ Fluxo completo finalizado!');
    _log('   Confira o WhatsApp: 4 mensagens devem ter chegado.');

  } catch (e) {
    _log('❌ ERRO no fluxo: ' + e.message);
    console.error(e.stack);
    Utils.enviarSimples(ADMIN_WHATSAPP,
      `🔴 *Erro no teste de relatório*\n\n` +
      `\`${e.message}\`\n\n` +
      `Verifique os logs do Apps Script para detalhes.`
    );
  }
}

/**
 * Mesmo fluxo completo, mas simulando um usuário sem permissão.
 * O admin receberá a mensagem de acesso negado no próprio número
 * (para que você possa ver como ela aparece).
 */
function enviarTeste_FluxoSemPermissao() {
  _log('TESTE: Fluxo com número sem permissão');

  // Sobrescreve temporariamente o número para simular um sem acesso
  const numeroFicticio = '5500000000000';

  // Chamamos verificarAcesso e enviamos o resultado para o admin ver
  const acesso = RelatorioHandler.verificarAcesso(numeroFicticio);
  _log('Resultado: ' + JSON.stringify(acesso));

  if (!acesso.temAcesso) {
    // Envia a mensagem de negação para o admin ver como ficou
    Utils.enviarSimples(ADMIN_WHATSAPP,
      `ℹ️ *Preview da mensagem de acesso negado:*\n\n` +
      `⛔ *Acesso restrito*\n\n` +
      `Esta funcionalidade é exclusiva para administradores e coordenadores de comunidade.\n\n` +
      `Se precisar de acesso, entre em contato com a secretaria. 🙏`
    );
    _log('✅ Acesso negado corretamente');
  } else {
    _log('❌ Número fictício foi autorizado — verificar lógica');
  }
}


// ============================================================================
// 5. SUITE COMPLETA COM WHATSAPP
// ============================================================================

/**
 * Roda todos os testes que enviam mensagens reais, em sequência.
 * Aguarda 1 segundo entre cada envio para não sobrecarregar a API.
 * O admin receberá todas as mensagens no WhatsApp.
 */
function enviarTeste_SuiteCompleta() {
  _log('╔══════════════════════════════════════╗');
  _log('║  SUITE COMPLETA — ENVIO WHATSAPP     ║');
  _log('╚══════════════════════════════════════╝');
  _log('Destinatário: ' + ADMIN_WHATSAPP);
  _log('');

  // Aviso inicial
  Utils.enviarSimples(ADMIN_WHATSAPP,
    `🧪 *Iniciando bateria de testes do Relatório*\n\n` +
    `Você receberá várias mensagens de teste em sequência.\n\n` +
    `_Ignore as interações — são apenas validações de layout._`
  );
  Utilities.sleep(800);

  // Layout
  enviarTeste_MenuPeriodo();         Utilities.sleep(800);
  enviarTeste_Cabecalho();           Utilities.sleep(800);
  enviarTeste_BlocoArrecadacao();    Utilities.sleep(800);
  enviarTeste_BlocoNovosCadastros(); Utilities.sleep(800);
  enviarTeste_BlocoEmAtraso();       Utilities.sleep(1000);

  // Dados reais
  enviarTeste_RelatorioRealMesAtual(); Utilities.sleep(1000);

  // Aviso final
  Utils.enviarSimples(ADMIN_WHATSAPP,
    `✅ *Testes concluídos!*\n\n` +
    `Verifique acima se todas as mensagens chegaram corretamente.\n\n` +
    `Se algo estiver errado, consulte os logs do Apps Script.`
  );

  _log('');
  _log('╔══════════════════════════════════════╗');
  _log('║  SUITE FINALIZADA                    ║');
  _log('╚══════════════════════════════════════╝');
}


// ============================================================================
// UTILITÁRIO INTERNO
// ============================================================================

function _log(msg) {
  console.log(msg);
}