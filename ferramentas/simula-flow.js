#!/usr/bin/env node
/**
 * ============================================================================
 * SIMULA-FLOW.JS — simulação de uma resposta de WhatsApp Flow
 * ============================================================================
 *
 * Manda ao webhook o mesmo `nfm_reply` que o aparelho mandaria ao apertar
 * "Enviar cadastro" no Flow. Serve para testar o FlowHandler INTEIRO sem criar
 * Flow nenhum na Meta e sem o app do WhatsApp.
 *
 * Por que isso é possível: no modo sem endpoint o Flow roda no cliente e só
 * devolve o resultado. Do lado do bot, um cadastro por Flow é exatamente uma
 * requisição HTTP — esta aqui.
 *
 * ⚠️ Escreve de verdade: o cadastro vai parar no Odoo se você confirmar o
 * resumo no WhatsApp. Use só contra ambiente descartável (o número padrão é
 * 5599..., o mesmo prefixo das ferramentas de teste).
 *
 * USO
 *   node simula-flow.js --url "<URL>/exec" --token "<SECRET>" --comunidade 3
 *
 *   --comunidade  id de uma comunidade real do Odoo (obrigatório)
 *   --de          número remetente        (padrão 5599900000002)
 *   --caso        ok | data-invalida | valor-zero | campo-faltando | token-errado
 *   --nome        sobrescreve o nome enviado
 *
 * O QUE ESPERAR NO CLOUD LOGGING
 *   --caso ok               "📝 [Flow] Resposta recebida" → "✅ [Flow] Cadastro
 *                           de ... montado em 1 execução" e o resumo chega no
 *                           WhatsApp com os 6 campos preenchidos.
 *   --caso data-invalida    "⚠️ [Flow] Cadastro recusado: Data de nascimento
 *                           inválida..." e NADA é gravado. É o teste que
 *                           importa: a validação do Flow roda no cliente, então
 *                           o servidor não pode confiar nela.
 *   --caso token-errado     "⚠️ [Flow] flow_token não reconhecido" → menu.
 *
 * COMPARAÇÃO QUE ESTE TESTE DEMONSTRA
 *   Cadastro por conversa: ~15 mensagens, ~9 execuções, cada resposta numa
 *   execução separada (é onde nasce a troca de campos do BL-29).
 *   Cadastro por Flow:      2 mensagens, 1 execução, sem corrida possível.
 */

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const URL_WEBHOOK = opt('url');
const TOKEN       = opt('token');
const COMUNIDADE  = opt('comunidade');
const DE          = opt('de', '5599900000002');
const CASO        = opt('caso', 'ok');

if (!URL_WEBHOOK || !TOKEN) {
  console.error('Faltou --url ou --token. Veja o cabeçalho do arquivo.');
  process.exit(1);
}
if (!COMUNIDADE) {
  console.error('Faltou --comunidade <id de uma comunidade real do Odoo>.');
  console.error('Sem id válido o FlowHandler recusa o cadastro e o teste não chega ao resumo.');
  process.exit(1);
}

/**
 * O payload que o Flow monta a partir do `on-click-action` do Footer.
 * Os nomes dos campos são os do flow-cadastro.json — se um mudar lá, muda aqui.
 */
function respostaDoFlow() {
  const base = {
    flow_token:      `cadastro:${DE}:${Date.now()}`,
    comunidade_id:   String(COMUNIDADE),
    nome:            opt('nome', 'Maria Aparecida da Silva'),
    nome_usual:      'Cida',
    data_nascimento: '15/03/1990',
    endereco:        'Rua das Flores, 123, Centro, perto da praça',
    valor_mensal:    '80,00',
    notificacao:     'sim',
    dia_preferido:   '10'
  };

  switch (CASO) {
    // Data que não existe. O Flow JSON não valida calendário, então este caso
    // chega mesmo em produção — e tem que ser barrado pelo servidor.
    case 'data-invalida':  return { ...base, data_nascimento: '31/02/1990' };

    // Zero passa pelo input-type number do Flow, mas não é dízimo.
    case 'valor-zero':     return { ...base, valor_mensal: '0' };

    // Campo ausente: é o que acontece se o Flow for editado e um componente
    // sair do formulário sem que o handler saiba.
    case 'campo-faltando': { const r = { ...base }; delete r.endereco; return r; }

    // Flow de outro fluxo (ou token forjado) — deve cair no menu, não no cadastro.
    case 'token-errado':   return { ...base, flow_token: 'outro_flow:123' };

    case 'ok':             return base;
    default:
      console.error(`Caso desconhecido: "${CASO}". Use ok | data-invalida | valor-zero | campo-faltando | token-errado.`);
      process.exit(1);
  }
}

function envelope(from, resposta) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'TESTE',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '0', phone_number_id: '0' },
          messages: [{
            from,
            // O webhook deduplica por messageId (cache de 10 min). Sem id único
            // a segunda rodada do teste seria ignorada em silêncio e pareceria
            // ter passado.
            id: `wamid.FLOW_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: {
              type: 'nfm_reply',
              nfm_reply: {
                name:          'flow',
                body:          'Enviado',
                // É string mesmo: a Meta entrega o payload do Flow como JSON
                // serializado dentro do JSON da mensagem.
                response_json: JSON.stringify(resposta)
              }
            }
          }]
        }
      }]
    }]
  };
}

async function main() {
  const resposta = respostaDoFlow();

  console.log(`Simulando um Flow de cadastro — caso "${CASO}", número ${DE}.\n`);
  console.log('response_json que o aparelho enviaria:');
  console.log(JSON.stringify(resposta, null, 2));
  console.log('');

  const inicio = Date.now();
  const url = `${URL_WEBHOOK}?token=${encodeURIComponent(TOKEN)}`;

  let r;
  try {
    r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(envelope(DE, resposta))
    });
  } catch (e) {
    console.error(`❌ Falhou a requisição: ${e.message}`);
    process.exit(1);
  }

  const ms    = Date.now() - inicio;
  const corpo = (await r.text()).slice(0, 120);

  console.log('─────────── Resultado ───────────');
  console.log(`HTTP ${r.status} em ${ms}ms — ${corpo}`);
  console.log(`Requisições: 1  (o cadastro por conversa levaria ~9)`);

  if (r.status !== 200) {
    console.log('\nStatus não-200 costuma ser token errado na URL ou webhook fora do ar.');
    process.exit(1);
  }

  console.log('\nO 200 diz só que o webhook aceitou. O veredito está em dois lugares:');
  console.log(`  1. Cloud Logging — procure por "[Flow]" nos últimos ${Math.ceil(ms / 1000) + 30}s.`);
  console.log(`  2. WhatsApp do número ${DE} — no caso "ok" chega o resumo do cadastro.`);
  console.log('\nLimpeza: limparContatosTeste() no editor do Apps Script apaga os 5599*.');
}

main();
