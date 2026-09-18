/**
 * ============================================================================
 * AUDITORIANUMEROS.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * BL-32 — Relatório dos números de WhatsApp gravados no Odoo.
 *
 * O PROBLEMA QUE ISTO ATACA
 *   No Brasil, o `wa_id` de muitos celulares é o número SEM o 9 depois do DDD,
 *   mesmo que o telefone o tenha. A Meta aceita os dois formatos e devolve
 *   HTTP 200 nos dois — só um chega. Uma mensagem para o formato errado é
 *   aceita, contada como enviada e nunca entregue, sem erro nenhum.
 *
 *   Quem se cadastrou pelo bot está correto POR CONSTRUÇÃO: o número gravado
 *   em `x_studio_partner_phone` vem do `from` do webhook, que é o `wa_id`. Não
 *   é convenção que alguém possa quebrar sem querer — é a origem do dado.
 *
 *   Por isso o relatório deve sair limpo, e é isso que o torna útil: cada
 *   suspeito na lista denuncia um contato que NÃO veio pelo bot — criado à mão
 *   no Odoo, importado de planilha. Essa é a única porta que não passa pelo
 *   webhook, e a que o lembrete mensal alcança sem ninguém conferir.
 *
 * O QUE ESTE ARQUIVO FAZ, E O QUE NÃO FAZ
 *   Faz: lê, classifica e imprime. Nada aqui escreve no Odoo.
 *
 *   Não faz: corrigir sozinho. A classificação é HEURÍSTICA — uma conta criada
 *   depois da mudança mantém o 9 mesmo num DDD da lista de suspeitos. Trocar
 *   por regra estragaria os números em que o 9 está certo, e o estrago seria
 *   do mesmo tipo do problema: silencioso.
 *
 *   Não existe atalho: a Cloud API não tem endpoint para validar um número
 *   (o `contacts` do On-Premises foi descontinuado e, mesmo lá, respondia
 *   "válido" para qualquer coisa). A única fonte exata do `wa_id` é uma
 *   mensagem RECEBIDA daquele número.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

/**
 * Lista os números de WhatsApp dos dizimistas, separando os que merecem
 * conferência manual.
 *
 * Menu: Executar → auditarNumerosWhatsApp
 */
function auditarNumerosWhatsApp() {
  Logger.log('🔎 Auditoria dos números de WhatsApp (BL-32)');
  Logger.log('');

  let registros;
  try {
    registros = OdooService.searchRead(
      'x_dizimista',
      ['id', 'x_name', 'x_studio_partner_phone', 'x_studio_notificacao_ativa'],
      [['x_active', '=', true]],
      { order: 'x_name asc', limit: 2000 }
    );
  } catch (e) {
    Logger.log(`❌ Falha ao ler o Odoo: ${e.message}`);
    return;
  }

  if (!registros || !registros.length) {
    Logger.log('Nenhum dizimista ativo encontrado.');
    return;
  }

  const suspeitos = [];
  const semNumero = [];
  const foraDoPadrao = [];
  let confiaveis = 0;

  registros.forEach(r => {
    const numero = String(r.x_studio_partner_phone || '').replace(/\D/g, '');

    if (!numero) { semNumero.push(r); return; }

    const v = Utils.variantesNumeroBR(numero);
    if (!v) { foraDoPadrao.push({ r, numero }); return; }

    if (v.provavel !== numero) {
      suspeitos.push({ r, numero, sugerido: v.provavel, ddd: v.ddd });
    } else {
      confiaveis++;
    }
  });

  // ── Resumo ────────────────────────────────────────────────────────────────
  Logger.log(`📊 ${registros.length} dizimista(s) ativo(s)`);
  Logger.log(`   ✅ ${confiaveis} no formato esperado para o DDD`);
  Logger.log(`   ⚠️ ${suspeitos.length} a conferir (nono dígito)`);
  Logger.log(`   ❔ ${foraDoPadrao.length} fora do padrão de celular`);
  Logger.log(`   ⬜ ${semNumero.length} sem número`);
  Logger.log('');

  // ── Suspeitos ─────────────────────────────────────────────────────────────
  if (suspeitos.length) {
    Logger.log('⚠️ A CONFERIR — o formato gravado difere do usual para o DDD.');
    Logger.log('   Os marcados com 📲 recebem lembrete mensal: são os que falham calado.');
    Logger.log('');
    suspeitos.forEach(s => {
      const lembrete = s.r.x_studio_notificacao_ativa ? '📲' : '  ';
      Logger.log(`   ${lembrete} #${s.r.id} ${String(s.r.x_name || '').substring(0, 28)}`);
      Logger.log(`        gravado: ${s.numero}   →   provável wa_id: ${s.sugerido}`);
    });
    Logger.log('');
    Logger.log('   ⚠️ NÃO troque no Odoo por conta desta lista. Ela é um palpite por');
    Logger.log('      DDD, e uma conta criada depois da mudança mantém o 9. Confirme');
    Logger.log('      com a pessoa, ou peça um "oi" ao bot: o número que chega pelo');
    Logger.log('      webhook é o wa_id de verdade.');
    Logger.log('');
  }

  if (foraDoPadrao.length) {
    Logger.log('❔ FORA DO PADRÃO — não parecem celular brasileiro (fixo? erro de digitação?)');
    foraDoPadrao.slice(0, 20).forEach(f => {
      Logger.log(`   #${f.r.id} ${String(f.r.x_name || '').substring(0, 28)}: ${f.numero}`);
    });
    if (foraDoPadrao.length > 20) Logger.log(`   … e mais ${foraDoPadrao.length - 20}`);
    Logger.log('');
  }

  if (semNumero.length) {
    Logger.log(`⬜ SEM NÚMERO — ${semNumero.length} registro(s); nunca receberão lembrete.`);
    semNumero.slice(0, 20).forEach(r => {
      Logger.log(`   #${r.id} ${String(r.x_name || '').substring(0, 40)}`);
    });
    if (semNumero.length > 20) Logger.log(`   … e mais ${semNumero.length - 20}`);
    Logger.log('');
  }

  if (!suspeitos.length && !foraDoPadrao.length && !semNumero.length) {
    Logger.log('✅ Nada a conferir.');
  }
}

/**
 * Compara um número com o que a heurística do BL-32 esperaria.
 * Útil para conferir um caso isolado sem rodar a auditoria inteira.
 *
 * Como rodar com argumento: veja `adicionarPropriedade` no Setup.gs — o editor
 * do Apps Script só executa funções sem parâmetros, então crie um envoltório.
 *
 * @param {string} numero - Ex.: '5586988521231'
 */
function conferirNumero(numero) {
  const v = Utils.variantesNumeroBR(numero);

  if (!v) {
    Logger.log(`❔ "${numero}" não é um celular brasileiro no formato esperado.`);
    Logger.log('   Esperado: 55 + DDD (2) + 8 ou 9 dígitos.');
    return;
  }

  Logger.log(`📱 ${numero}  (DDD ${v.ddd})`);
  Logger.log(`   com o 9: ${v.comNove}`);
  Logger.log(`   sem o 9: ${v.semNove}`);
  Logger.log(`   provável wa_id: ${v.provavel}`);
  Logger.log('');
  Logger.log(v.provavel === String(numero).replace(/\D/g, '')
    ? '   ✅ É o formato usual para este DDD.'
    : '   ⚠️ Difere do usual para este DDD — vale conferir.');
  Logger.log('');
  Logger.log('   Lembre: é palpite por DDD. Só uma mensagem recebida daquele número');
  Logger.log('   prova qual é o wa_id.');
}
