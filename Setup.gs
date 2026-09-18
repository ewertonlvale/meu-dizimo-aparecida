/**
 * ============================================
 * SETUP INICIAL - EXECUTE APENAS UMA VEZ
 * ============================================
 * 
 * Este arquivo contém funções para configurar as propriedades
 * do projeto de forma segura.
 * 
 * INSTRUÇÕES:
 * 1. Edite os valores na função setupProperties() abaixo
 * 2. Execute a função setupProperties()
 * 3. Verifique os logs
 * 4. Execute verificarProperties() para confirmar
 * 5. Delete ou comente este arquivo após configuração
 * 
 * Versão: 1.0
 * Data: Fevereiro 2026
 */

/**
 * ============================================
 * CONFIGURAÇÃO INICIAL DAS PROPRIEDADES
 * ============================================
 * 
 * EXECUTE ESTA FUNÇÃO UMA ÚNICA VEZ
 */
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  
  // ⚠️ EDITE OS VALORES ABAIXO COM SUAS CREDENCIAIS REAIS:
  const configuracoes = {
    // ==========================================
    // WhatsApp Business API
    // ==========================================
    // Obtenha em: https://developers.facebook.com
    'WHATSAPP_TOKEN': 'COLE_SEU_TOKEN_AQUI',
    'WHATSAPP_PHONE_ID': 'COLE_SEU_PHONE_ID_AQUI',
    'VERIFY_TOKEN': 'meu_dizimo_2024',

    // Segredo do webhook: OBRIGATÓRIO (BL-17) — sem ele o webhook rejeita todo
    // POST. Prefira rodar configurarSegredoWebhook(), que gera um valor forte e
    // já imprime a URL de callback pronta para colar na Meta.
    // (Apps Script não expõe headers, então autenticamos pela query string.)
    'WEBHOOK_SECRET': 'COLE_UM_SEGREDO_ALEATORIO_AQUI',
    
    // ==========================================
    // Odoo ERP
    // ==========================================
    // Configure seu servidor Odoo
    'ODOO_URL': 'https://meu-dizimo.odoo.com/',
    'ODOO_DATABASE': 'meu-dizimo',
    'ODOO_UID': '2',
    'ODOO_API_KEY': 'COLE_SUA_ODOO_KEY_AQUI',
    
    // ==========================================
    // Google Vision API
    // ==========================================
    // Obtenha em: https://console.cloud.google.com
    'GOOGLE_VISION_API_KEY': 'COLE_SUA_VISION_KEY_AQUI'
  };
  
  // Validar se você editou os valores
  const valores = Object.values(configuracoes);
  if (valores.some(v => v.includes('COLE_'))) {
    Logger.log('');
    Logger.log('❌ ERRO: Você precisa editar os valores acima!');
    Logger.log('❌ Substitua todos os COLE_SEU_..._AQUI pelos valores reais');
    Logger.log('');
    Logger.log('📋 Propriedades que precisam ser configuradas:');
    Object.keys(configuracoes).forEach(key => {
      if (configuracoes[key].includes('COLE_')) {
        Logger.log(`   ❌ ${key}`);
      }
    });
    return;
  }
  
  // Salvar propriedades
  props.setProperties(configuracoes);
  
  // Confirmar
  Logger.log('');
  Logger.log('✅ Propriedades configuradas com sucesso!');
  Logger.log('');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('📋 PROPRIEDADES SALVAS:');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  
  // Listar (mascarando valores sensíveis)
  Object.keys(configuracoes).forEach(key => {
    Logger.log(`✅ ${key}:`);
    Logger.log(`   ${_mascararValorProp(key, props.getProperty(key))}`);
    Logger.log('');
  });
  
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  Logger.log('🎉 Setup completo!');
  Logger.log('');
  Logger.log('📝 PRÓXIMOS PASSOS:');
  Logger.log('1. Execute verificarProperties() para confirmar');
  Logger.log('2. Execute testarConexaoOdoo() para testar o Odoo');
  Logger.log('3. Execute configurarSegredoWebhook() e cole a URL na Meta');
  Logger.log('4. Delete ou comente este arquivo Setup.gs');
  Logger.log('');
}

/**
 * ============================================
 * BL-17 — SEGREDO DO WEBHOOK (OBRIGATÓRIO)
 * ============================================
 *
 * Gera um WEBHOOK_SECRET aleatório, salva nas Script Properties e imprime a
 * URL de callback completa para colar na Meta.
 *
 * ⚠️ ORDEM IMPORTA. O webhook rejeita todo POST sem o token correto, e o Apps
 * Script sempre responde 200 — ou seja, a Meta NÃO reenvia o que for rejeitado
 * e as mensagens são perdidas. Faça nesta ordem:
 *   1. Execute esta função e copie a URL impressa no log.
 *   2. Cole a URL na configuração do webhook na Meta (Callback URL).
 *   3. Só então republique o deployment com o código novo.
 *
 * Se o segredo já existir, a função não o troca — apenas reimprime a URL.
 */
function configurarSegredoWebhook() {
  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty('WEBHOOK_SECRET')) {
    // UUID v4 do Apps Script é aleatório; dois deles dão 64 chars hex.
    const segredo = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('WEBHOOK_SECRET', segredo);
    Logger.log('✅ WEBHOOK_SECRET gerado e salvo.');
  } else {
    Logger.log('ℹ️ WEBHOOK_SECRET já existe — mantido.');
    Logger.log('   Para trocá-lo, apague a propriedade e rode esta função de novo.');
  }

  const segredo = props.getProperty('WEBHOOK_SECRET');

  let url = null;
  try {
    url = ScriptApp.getService().getUrl();
  } catch (e) {
    Logger.log(`⚠️ Não consegui obter a URL do deployment: ${e.message}`);
  }

  Logger.log('');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('📋 URL DE CALLBACK PARA A META');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (url) {
    Logger.log(`${url}?token=${segredo}`);
  } else {
    Logger.log(`<URL DO SEU DEPLOYMENT>/exec?token=${segredo}`);
    Logger.log('(pegue a URL em Implantar → Gerenciar implantações)');
  }
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  Logger.log('🔒 Esta URL contém o segredo — trate como credencial.');
  Logger.log('📝 Cole na Meta ANTES de republicar o deployment.');
  Logger.log('');
}

/**
 * ============================================
 * VERIFICAR SE AS PROPRIEDADES ESTÃO OK
 * ============================================
 */
function verificarProperties() {
  const props = PropertiesService.getScriptProperties();
  
  const propriedadesNecessarias = [
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_ID',
    'WEBHOOK_SECRET',
    'GOOGLE_VISION_API_KEY',
    'ODOO_URL',
    'ODOO_DATABASE',
    'ODOO_UID',
    'ODOO_API_KEY'
  ];
  
  Logger.log('');
  Logger.log('🔍 Verificando propriedades...');
  Logger.log('');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  let todasConfiguradas = true;
  
  propriedadesNecessarias.forEach(prop => {
    const valor = props.getProperty(prop);
    const status = valor ? '✅' : '❌';
    
    let info;
    if (!valor) {
      info = 'NÃO CONFIGURADA';
      todasConfiguradas = false;
    } else {
      info = _mascararValorProp(prop, valor);
    }
    
    Logger.log(`${status} ${prop}: ${info}`);
  });
  
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  
  // BL-17: uid 2 é o administrador do Odoo. O bot só precisa dos modelos x_*,
  // então rodar como admin dá muito mais acesso do que a função exige — se as
  // credenciais vazarem, o estrago é o ERP inteiro, não só os dados do bot.
  if (props.getProperty('ODOO_UID') === '2') {
    Logger.log('');
    Logger.log('⚠️ ODOO_UID = 2 (administrador) — recomendado trocar:');
    Logger.log('   1. No Odoo, crie um usuário dedicado ao bot (ex.: "Bot Meu Dízimo").');
    Logger.log('   2. Dê acesso apenas aos modelos x_* que o bot usa.');
    Logger.log('   3. Gere uma API key para esse usuário.');
    Logger.log('   4. Atualize ODOO_UID e ODOO_API_KEY e rode testarConexaoOdoo().');
    Logger.log('');
  }

  if (todasConfiguradas) {
    Logger.log('✅ Todas as propriedades estão configuradas!');
    Logger.log('');
    Logger.log('🎉 Você pode começar a usar o bot!');
    Logger.log('');
    Logger.log('📝 Verificações recomendadas:');
    Logger.log('   - testarConexaoOdoo()');
    Logger.log('   - configurarSegredoWebhook()  (confere a URL de callback)');
    Logger.log('   A suíte completa (Tests.gs) não vai no deploy — ver .claspignore.');
  } else {
    Logger.log('❌ Algumas propriedades estão faltando.');
    Logger.log('');
    Logger.log('Execute setupProperties() para configurar.');
  }
  
  Logger.log('');
}

/**
 * Propriedades cujo valor pode aparecer inteiro no log.
 *
 * É uma lista de PERMITIDOS, não de proibidos, de propósito: assim qualquer
 * propriedade nova nasce mascarada. A regra anterior mascarava por substring do
 * nome ('KEY', 'TOKEN', 'API') e, por isso, imprimia o `WEBHOOK_SECRET` inteiro
 * no log — justamente o segredo que autentica o webhook. `WHATSAPP_PIN` tinha o
 * mesmo problema.
 */
const PROPS_NAO_SENSIVEIS = [
  'WHATSAPP_PHONE_ID',
  'ODOO_URL',
  'ODOO_DATABASE',
  'ODOO_UID',
  'NOTIFICACOES_ATIVAS'
];

/**
 * Devolve o valor pronto para log: inteiro se for inócuo, senão um prefixo
 * curto com o tamanho — o bastante para conferir qual valor está lá, sem
 * expor o segredo.
 * @private
 */
function _mascararValorProp(chave, valor) {
  if (!valor) return valor;
  if (PROPS_NAO_SENSIVEIS.indexOf(chave) >= 0) return valor;

  const texto = String(valor);
  // Valor curto (um PIN de 6 dígitos, por exemplo): qualquer prefixo já o
  // entregaria por inteiro. Nestes casos só o tamanho vai para o log.
  if (texto.length < 16) return `•••• (${texto.length} caracteres)`;

  return `${texto.substring(0, 6)}… (${texto.length} caracteres)`;
}

/**
 * ============================================
 * TESTAR CONEXÃO COM O ODOO
 * ============================================
 *
 * Faz uma leitura mínima para validar URL, database, uid e API key.
 * Vive aqui, e não em `Tests.gs`, porque a suíte de testes não vai no deploy
 * (ver `.claspignore` — BL-16); esta verificação precisa estar disponível no
 * projeto publicado, logo após a configuração.
 */
function testarConexaoOdoo() {
  Logger.log('');
  Logger.log('🔌 Testando conexão com o Odoo...');

  try {
    const comunidades = OdooService.searchRead(
      'x_comunidade', ['id', 'x_name'], [], { limit: 1 }
    );

    Logger.log('✅ Conexão OK — o Odoo respondeu.');
    Logger.log(`   Comunidades acessíveis: ${comunidades.length > 0 ? 'sim' : 'nenhuma encontrada'}`);

    const uid = PropertiesService.getScriptProperties().getProperty('ODOO_UID');
    Logger.log(`   Conectado com ODOO_UID = ${uid}${uid === '2' ? ' (administrador — ver BL-17)' : ''}`);

  } catch (e) {
    Logger.log(`❌ Falha na conexão: ${e.message}`);
    Logger.log('   Confira ODOO_URL, ODOO_DATABASE, ODOO_UID e ODOO_API_KEY com verificarProperties().');
  }

  Logger.log('');
}

/**
 * ============================================
 * CONSUMO DE MENSAGENS DO WHATSAPP
 * ============================================
 *
 * Mostra quantas mensagens o bot entregou no mês e projeta o total até o
 * fechamento, no ritmo atual.
 *
 * Existe porque, desde 01/10/2026, a Meta cobra as mensagens de serviço acima
 * de uma franquia mensal por número. O contador de UrlFetch não serve para isso:
 * ele soma Odoo, OCR e uploads junto, e nada disso é cobrado.
 *
 * ⚠️ A contagem começa do zero quando esta versão entra no ar — meses
 * anteriores não têm dado. E é aproximada: os contadores são distribuídos em
 * shards para evitar lock, então execuções concorrentes podem perder um
 * incremento. Serve para ordem de grandeza e alerta com folga, não para
 * conferir fatura.
 */
function verificarConsumoMensagens() {
  // `somarMensagensDoMes` em vez de `verificarCotaMensagens`: a segunda APAGA os
  // meses vencidos e loga por conta própria no console. Um relatório manual não
  // deve alterar estado nem imprimir os mesmos números duas vezes, em duas
  // fontes diferentes — quem for depurar cota desconfia das duas.
  let contagem;
  try {
    contagem = Utils.somarMensagensDoMes();
  } catch (e) {
    Logger.log(`❌ Não consegui ler os contadores: ${e.message}`);
    return;
  }

  const agora     = new Date();
  const diaDoMes  = Number(Utilities.formatDate(agora, 'America/Sao_Paulo', 'd'));
  const ultimoDia = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const projecao  = Math.round((contagem.servico / diaDoMes) * ultimoDia);
  const franquia  = Utils.MSG_FRANQUIA_SERVICO;

  Logger.log('');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('📊 MENSAGENS ENTREGUES NESTE MÊS');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log(`   Serviço:   ${contagem.servico}  (franquia mensal: ${franquia})`);
  Logger.log(`   Template:  ${contagem.template}  (tarifa própria, fora da franquia)`);
  Logger.log('');
  Logger.log(`   Dia ${diaDoMes} de ${ultimoDia} → projeção de ${projecao} mensagens de serviço no mês`);
  Logger.log('');

  if (projecao > franquia) {
    Logger.log(`🚨 A projeção passa da franquia em ~${projecao - franquia} mensagens.`);
    Logger.log('   Onde há mais a ganhar: o cadastro gasta ~15 mensagens por pessoa,');
    Logger.log('   sendo ~10 o par "✅ registrado" + "próxima pergunta", que poderiam');
    Logger.log('   virar uma só. Ver também a análise do WhatsApp Flows no backlog.');
  } else {
    Logger.log('✅ No ritmo atual, o mês fecha dentro da franquia.');
  }
  Logger.log('');
}

/**
 * ============================================
 * LIMPAR TODAS AS PROPRIEDADES (CUIDADO!)
 * ============================================
 */
function limparTodasProperties() {
  const ui = SpreadsheetApp.getUi(); // Ou DocumentApp.getUi() ou FormApp.getUi()
  
  const resposta = ui.alert(
    'ATENÇÃO - OPERAÇÃO PERIGOSA',
    'Tem certeza que deseja DELETAR todas as propriedades?\n\nIsso irá apagar:\n- Tokens do WhatsApp\n- Credenciais do Odoo\n- Chave da Vision API\n\nVocê precisará executar setupProperties() novamente!',
    ui.ButtonSet.YES_NO
  );
  
  if (resposta === ui.Button.YES) {
    PropertiesService.getScriptProperties().deleteAllProperties();
    Logger.log('');
    Logger.log('🗑️ Todas as propriedades foram deletadas.');
    Logger.log('');
    Logger.log('Execute setupProperties() para reconfigurar.');
    Logger.log('');
  } else {
    Logger.log('');
    Logger.log('❌ Operação cancelada.');
    Logger.log('');
  }
}

/**
 * ============================================
 * ADICIONAR UMA PROPRIEDADE INDIVIDUAL
 * ============================================
 */
function adicionarPropriedade(chave, valor) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(chave, valor);
  
  Logger.log('');
  Logger.log(`✅ Propriedade "${chave}" adicionada/atualizada`);
  Logger.log('');
}

/**
 * ============================================
 * REMOVER UMA PROPRIEDADE INDIVIDUAL
 * ============================================
 */
function removerPropriedade(chave) {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(chave);
  
  Logger.log('');
  Logger.log(`🗑️ Propriedade "${chave}" removida`);
  Logger.log('');
}

/**
 * ============================================
 * LISTAR TODAS AS PROPRIEDADES (SEM VALORES)
 * ============================================
 */
function listarPropriedades() {
  const props = PropertiesService.getScriptProperties();
  const todasProps = props.getProperties();
  
  Logger.log('');
  Logger.log('📋 Propriedades configuradas:');
  Logger.log('');
  
  if (Object.keys(todasProps).length === 0) {
    Logger.log('   (nenhuma propriedade configurada)');
  } else {
    Object.keys(todasProps).forEach(key => {
      Logger.log(`   - ${key}`);
    });
  }
  
  Logger.log('');
  Logger.log(`Total: ${Object.keys(todasProps).length} propriedade(s)`);
  Logger.log('');
}

// ============================================================================
// TESTE DO FLOW DE CADASTRO NO APARELHO
// ============================================================================

/**
 * Manda o Flow de cadastro para um número de verdade.
 *
 * Funciona com o Flow publicado ou em rascunho: a Meta aceita `mode: 'draft'`
 * para a versão não publicada, então dá para abrir o formulário no WhatsApp
 * antes de publicar o Flow — e o modo certo é descoberto sozinho.
 *
 * ANTES DE RODAR
 *   1. WhatsApp Manager → Flows → criar o Flow, colar o conteúdo de
 *      `ferramentas/flow-cadastro.json` e SALVAR (não precisa publicar).
 *   2. Copiar o id do Flow e guardar em Script Properties:
 *      adicionarPropriedade('FLOW_ID_CADASTRO', '<id>')
 *   3. Guardar o número de teste em NUMERO_TESTE (formato 5586999998888),
 *      ou passar o número direto: enviarFlowDeTeste('5586999998888')
 *
 * O modo se ajusta sozinho e fica guardado em `FLOW_MODO_CADASTRO`: não é
 * preciso saber em que estado o Flow está, e a descoberta não se repete a cada
 * envio.
 *
 * ⚠️ ENQUANTO o Flow está em rascunho, só abre para números com papel na conta
 * da Meta (admin, desenvolvedor ou testador). Num número qualquer o botão
 * aparece mas não abre — não é bug do bot. Depois de publicado, abre para
 * qualquer um.
 *
 * ⚠️ A janela de 24h vale aqui: o número precisa ter mandado alguma mensagem
 * ao bot nas últimas 24 horas, senão a Meta recusa o envio.
 *
 * @param {string} [numero] - Destinatário. Omitido, usa NUMERO_TESTE.
 */
function enviarFlowDeTeste(numero) {
  const props = PropertiesService.getScriptProperties();
  const destino = numero || props.getProperty('NUMERO_TESTE');

  if (!destino) {
    Logger.log('❌ Informe o número ou configure NUMERO_TESTE.');
    Logger.log("   Exemplo: enviarFlowDeTeste('5586999998888')");
    return;
  }

  if (!props.getProperty('FLOW_ID_CADASTRO')) {
    Logger.log('❌ FLOW_ID_CADASTRO não configurado.');
    Logger.log('   Crie o Flow no WhatsApp Manager com o conteúdo de');
    Logger.log('   ferramentas/flow-cadastro.json, salve e guarde o id:');
    Logger.log("   adicionarPropriedade('FLOW_ID_CADASTRO', '<id do Flow>')");
    return;
  }

  // Uma mensagem simples ANTES do formulário separa dois problemas que se
  // parecem: "o Flow não chega" e "nada chega". Sem ela, um token vencido,
  // uma janela de 24h fechada ou um número errado ficam indistinguíveis de
  // uma incompatibilidade do Flow — e só o primeiro grupo é comum.
  Logger.log(`📤 Enviando mensagem simples de controle para ${destino}...`);
  const controle = Utils.enviarSimples(destino,
    '🔎 *Teste de entrega*\n\nSe você está lendo isto, mensagens comuns chegam ' +
    'normalmente. O formulário de cadastro vem logo a seguir.'
  );
  const controleOk = !!controle && controle.getResponseCode() === 200;
  Logger.log(`   ${controleOk ? '✅ aceita pela Meta' : '❌ recusada — veja o erro acima'}`);

  Logger.log(`📤 Enviando o Flow de cadastro para ${destino}...`);

  // O modo (rascunho/publicado) é do `enviarFlowCadastro`: ele começa pelo
  // último que funcionou e troca se a Meta recusar. Na primeira vez após uma
  // mudança de estado do Flow, a troca aparece no log como um ❌ de [WhatsApp]
  // seguido de um ℹ️ de [Flow] — e não se repete. Se o ❌ vier sozinho, a
  // recusa NÃO foi por modo: leia o `details` dele.
  const enviou = FlowHandler.enviarFlowCadastro(destino);

  if (enviou) {
    Logger.log('');
    Logger.log('✅ As duas mensagens foram aceitas pela Meta. No celular, leia nesta ordem:');
    Logger.log('   1. Chegou a mensagem "🔎 Teste de entrega"?');
    Logger.log('      NÃO → o problema não é o Flow. É o número, a janela de 24h ou o token.');
    Logger.log('      SIM → o canal está bom; siga para o 2.');
    Logger.log('   2. Chegou o cartão "💛 Cadastro de Dizimista" com o botão?');
    Logger.log('      NÃO → é específico do Flow. O motivo estará em "❌ [Entrega]" no');
    Logger.log('            Cloud Logging, alguns segundos depois desta execução.');
    Logger.log('      SIM → toque em "Preencher cadastro" e preencha.');
    Logger.log('');
    Logger.log('   Depois de enviar o formulário, procure por "[Flow]" no Cloud Logging:');
    Logger.log('   o response_json chega inteiro numa execução só.');
  } else {
    Logger.log('❌ Não enviou. Causas comuns, em ordem de frequência:');
    Logger.log('   - Janela de 24h fechada: mande "oi" ao bot por esse número e tente de novo');
    Logger.log('   - Flow ainda não salvo na Meta, ou id errado em FLOW_ID_CADASTRO');
    Logger.log('   - Flow despublicado ou removido depois de configurado o id');
    Logger.log('   - Nenhuma comunidade ativa no Odoo (a lista vai dentro do Flow)');
    Logger.log('   O erro exato está no log de [WhatsApp] logo acima.');
  }
}

/**
 * Liga o formulário no fluxo de cadastro (BL-33).
 *
 * A partir daqui, `CadastroHandler.iniciar` manda o Flow em vez de começar a
 * conversa. O caminho por conversa continua de pé como destino de quem abre o
 * formulário e desiste, de quem está num aparelho que não o renderiza e de
 * quem cai na validação do servidor.
 *
 * Exige FLOW_ID_CADASTRO configurado.
 */
function ativarFlowCadastro() {
  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty('FLOW_ID_CADASTRO')) {
    Logger.log('❌ FLOW_ID_CADASTRO não configurado — o Flow não teria o que abrir.');
    Logger.log("   adicionarPropriedade('FLOW_ID_CADASTRO', '<id do Flow>')");
    return;
  }

  props.setProperty('FLOW_CADASTRO_ATIVO', 'true');
  Logger.log('✅ Flow de cadastro ATIVADO.');
  Logger.log('   Novos cadastros passam a receber o formulário.');
  Logger.log('   Para voltar atrás: desativarFlowCadastro()');
}

/**
 * Desliga o formulário e volta ao cadastro por conversa (BL-33).
 *
 * Existe separado de apagar o FLOW_ID_CADASTRO de propósito: numa hora ruim,
 * com gente cadastrando, o que se quer é voltar em segundos sem perder a
 * configuração — e poder religar do mesmo jeito.
 *
 * Quem já estiver com o formulário aberto termina por ele: a resposta continua
 * sendo aceita. O desligamento vale para os PRÓXIMOS cadastros.
 */
function desativarFlowCadastro() {
  PropertiesService.getScriptProperties().setProperty('FLOW_CADASTRO_ATIVO', 'false');
  Logger.log('🛑 Flow de cadastro DESATIVADO — novos cadastros vão pela conversa.');
  Logger.log('   O FLOW_ID_CADASTRO foi mantido; religue com ativarFlowCadastro().');
  Logger.log('   Quem já está com o formulário aberto consegue terminar por ele.');
}

// ============================================================================
// SESSÕES DE CADASTRO
// ============================================================================

/**
 * Mostra quem está com cadastro em andamento. Só lê.
 *
 * Rode antes de `limparTodasSessoes()`: a limpeza apaga o progresso de quem
 * estiver no meio do cadastro, e essa gente não recebe aviso nenhum — do lado
 * dela, a próxima resposta simplesmente cai no menu.
 */
function listarSessoesAtivas() {
  const props = PropertiesService.getScriptProperties();
  const todas = props.getProperties();
  const cache = CacheService.getScriptCache();
  const pref  = StateManager.PREFIXO_SESSAO;

  const numeros = Object.keys(todas)
    .filter(c => c.indexOf(pref) === 0)
    .map(c => c.slice(pref.length));

  if (!numeros.length) {
    Logger.log('✅ Nenhuma sessão de cadastro ativa.');
    return [];
  }

  Logger.log(`📋 ${numeros.length} sessão(ões) ativa(s):`);
  Logger.log('');

  numeros.forEach(from => {
    const estado  = cache.get(`estado_${from}`) || '(fora do cache)';
    const inicio  = parseInt(todas[pref + from], 10);
    const minutos = inicio ? Math.floor((Date.now() - inicio) / 60000) : '?';
    Logger.log(`   ${from}  ·  ${estado}  ·  há ${minutos} min`);
  });

  Logger.log('');
  Logger.log('Para apagar todas: limparTodasSessoes()');
  return numeros;
}

/**
 * Apaga TODAS as sessões de cadastro em andamento.
 *
 * ⚠️ Quem estiver no meio de um cadastro perde o progresso, e **sem aviso**:
 * do lado da pessoa, a próxima resposta cai no menu sem explicação. Rode
 * `listarSessoesAtivas()` antes para ver quem será afetado.
 *
 * O QUE APAGA, por número: `estado_`, `dados_`, `log_cadastro_`,
 * `sessao_inicio_`, `aviso_sessao_` e a propriedade `sessao_ativa_`.
 *
 * O QUE **NÃO** APAGA: o `contato_<numero>` (cache de 6 h que marca o número
 * como conhecido). É de propósito — apagá-lo faria o bot dar boas-vindas de
 * novo a quem já é do sistema. Para isso existe `limparCacheContatos()`.
 *
 * ⚠️ LIMITE DO CACHE: só alcança sessões que ainda têm a propriedade
 * `sessao_ativa_`. O CacheService **não permite listar chaves**, então uma
 * sessão cuja propriedade já sumiu deixa restos no cache — que expiram
 * sozinhos em no máximo 6 h. Ver ARQUITETURA.md, seção 1.
 */
function limparTodasSessoes() {
  const numeros = listarSessoesAtivas();
  if (!numeros.length) return;

  Logger.log('');
  Logger.log('🧹 Limpando...');

  let limpas = 0;
  numeros.forEach(from => {
    try {
      StateManager.limparDados(from);
      limpas++;
    } catch (e) {
      Logger.log(`   ⚠️ Falhou em ${from}: ${e.message}`);
    }
  });

  Logger.log('');
  Logger.log(`✅ ${limpas} de ${numeros.length} sessão(ões) limpa(s).`);
  if (limpas < numeros.length) {
    Logger.log('   As que falharam podem ser tentadas de novo: nada aqui é cumulativo.');
  }
}

/**
 * Apaga o cache que marca números como "já conhecidos" (`contato_<numero>`).
 *
 * Efeito: as pessoas afetadas recebem a mensagem de boas-vindas de novo no
 * próximo contato, como se fosse a primeira vez. É útil ao testar o primeiro
 * contato; em produção, é ruído para quem já usa o bot.
 *
 * ⚠️ Pelo mesmo limite do CacheService, isto só alcança os números que você
 * informar — não há como listar as chaves do cache. Passe uma lista:
 *
 *   limparCacheContatos(['5586988521231', '5586999998888'])
 */
function limparCacheContatos(numeros) {
  if (!Array.isArray(numeros) || !numeros.length) {
    Logger.log('❌ Informe a lista de números.');
    Logger.log("   Exemplo: limparCacheContatos(['5586988521231'])");
    Logger.log('   Não dá para limpar "todos": o CacheService não lista chaves.');
    return;
  }

  const cache = CacheService.getScriptCache();
  numeros.forEach(n => cache.remove(`contato_${n}`));
  Logger.log(`🗑️ Cache de contato limpo para ${numeros.length} número(s).`);
  Logger.log('   Eles receberão as boas-vindas de novo no próximo contato.');
}

/**
 * ============================================
 * EXEMPLOS DE USO
 * ============================================
 */

// Adicionar uma propriedade específica:
// adicionarPropriedade('WHATSAPP_TOKEN', 'EAAxxxxx...');

// Remover uma propriedade específica:
// removerPropriedade('WHATSAPP_TOKEN');

// Ver todas as propriedades (apenas nomes, sem valores):
// listarPropriedades();