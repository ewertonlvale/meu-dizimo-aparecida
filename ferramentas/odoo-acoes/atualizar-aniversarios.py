# ============================================================================
# Aniversário do dizimista no ano corrente — para a view de calendário
#
# Roda como AÇÃO AGENDADA do Odoo (ir.cron → ir.actions.server).
#
# POR QUE ESTE CAMPO PRECISA EXISTIR
#   O calendário do Odoo posiciona o evento pela data que o campo guarda. E
#   `x_studio_date` guarda a data de NASCIMENTO: 14/03/1975. Um calendário
#   apontado para ele põe a pessoa em março de 1975 — abrir o mês corrente não
#   mostra ninguém, e nada acusa o erro. Era exatamente o que a view 595 fazia
#   desde que foi criada.
#
#   `x_studio_aniversario` guarda o mesmo dia e mês, no ANO CORRENTE. É o que
#   o calendário consegue mostrar.
#
# POR QUE NÃO UM CAMPO CALCULADO, QUE SERIA MAIS ELEGANTE
#   Campo calculado só recalcula quando uma dependência muda. A dependência
#   aqui seria a data de nascimento, que não muda nunca — e o que muda é o ano,
#   que não é dependência de nada. Em 1º de janeiro o campo continuaria com o
#   ano velho, e o calendário voltaria a ficar vazio, de novo em silêncio.
#
#   Campo gravado mais ação diária resolve, ao custo de uma varredura por dia.
#
# O CUSTO REAL É BAIXO
#   A ação só ESCREVE onde o valor difere. Depois da virada do ano, os 364 dias
#   seguintes fazem uma leitura e nenhuma escrita. E as escritas são agrupadas
#   por data: numa paróquia de 508 pessoas, muitas dividem aniversário.
#
# 29 DE FEVEREIRO
#   `date(1976, 2, 29).replace(year=2027)` levanta ValueError — ano não
#   bissexto não tem dia 29. Sem tratar, a exceção derruba a ação INTEIRA e
#   ninguém mais é atualizado por causa de uma pessoa. Quem nasceu em 29/02
#   aparece em 28/02, que é o que o calendário civil brasileiro faz.
#
# ESTE ARQUIVO É A FONTE. O que está no Odoo é cópia.
# ============================================================================

CAMPO = 'x_studio_aniversario'

campos = env['x_dizimista']._fields

if CAMPO not in campos:
    # Sem o campo não há o que atualizar. Falhar alto seria pior: a ação roda
    # sozinha todo dia, e um erro diário no log esconde os erros de verdade.
    log('%s não existe em x_dizimista — rode ferramentas/instalar-aniversarios.mjs --aplicar' % CAMPO)
else:
    hoje = datetime.date.today()
    ano = hoje.year

    # `search` sem domínio de x_active já exclui os arquivados. Quem foi
    # arquivado não precisa aparecer na lista de aniversariantes.
    dizimistas = env['x_dizimista'].sudo().search([('x_studio_date', '!=', False)])

    # Agrupar por data alvo troca ~500 escritas por ~300 na virada do ano, e
    # por nenhuma nos outros dias.
    por_data = {}
    for d in dizimistas:
        nasc = d.x_studio_date
        try:
            alvo = nasc.replace(year=ano)
        except ValueError:
            alvo = datetime.date(ano, 2, 28)
        if d.x_studio_aniversario != alvo:
            if alvo not in por_data:
                por_data[alvo] = []
            por_data[alvo].append(d.id)

    mexidos = 0
    for alvo in por_data:
        ids = por_data[alvo]
        env['x_dizimista'].sudo().browse(ids).write({CAMPO: alvo})
        mexidos += len(ids)

    log('Aniversários %d: %d dizimista(s) com data, %d atualizado(s), %d escrita(s)'
        % (ano, len(dizimistas), mexidos, len(por_data)))
