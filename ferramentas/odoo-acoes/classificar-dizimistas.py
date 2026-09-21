# ============================================================================
# Classificação automática do dizimista — Regular / Eventual / Inativo
#
# Roda como AÇÃO AGENDADA do Odoo (ir.cron → ir.actions.server).
#
# POR QUE AQUI E NÃO NO APPS SCRIPT
#   São 508 dizimistas e milhares de devoluções. Pelo Apps Script seria uma
#   chamada RPC por pessoa, contra o teto de 6 minutos por execução. Aqui é
#   uma leitura só, do lado dos dados.
#
# ESTE ARQUIVO É A FONTE. O que está no Odoo é cópia.
#   Ação agendada não tem histórico, nem diff, nem revisão — é o achado D3 da
#   análise. Versionar o código aqui e instalar a partir dele devolve as três
#   coisas. Quem editar direto no Odoo perde isso, e o próximo `--simular` do
#   instalador vai acusar a divergência.
#
# ----------------------------------------------------------------------------
# A REGRA
#
#   Regular   devolveu em CADA UM dos últimos N meses completos
#   Eventual  devolveu ao menos uma vez na janela de M meses (mês atual
#             incluído), mas não em todos os N
#   Inativo   nenhuma devolução na janela de M meses
#
#   N = x_studio_meses_regular   (padrão 3)
#   M = x_studio_meses_inativo   (padrão 3)
#
# O MÊS CORRENTE NÃO CONTA PARA "REGULAR", de propósito.
#   Dia 2 do mês, quase ninguém devolveu ainda. Exigir o mês corrente
#   rebaixaria a paróquia inteira todo dia 1º e a promoveria de volta ao longo
#   do mês. Regular olha para os N meses FECHADOS; o mês corrente conta a
#   favor (para não virar Inativo), nunca contra.
#
# QUEM ACABOU DE SE CADASTRAR NÃO É INATIVO.
#   "Mais de 3 meses sem devolver" é falso para quem existe há três semanas.
#   Sem essa guarda, todo cadastro novo nasceria Inativo — e Inativo é um
#   rótulo que a secretaria lê como "desistiu".
# ============================================================================

# ── Parâmetros ──────────────────────────────────────────────────────────────
# Lidos de x_parametros. Se os campos ainda não existirem, ou vierem vazios,
# valem os padrões: a ação precisa funcionar ANTES de alguém configurar nada.
MESES_REGULAR_PADRAO = 3
MESES_INATIVO_PADRAO = 3

campos_param = env['x_parametros']._fields
param = env['x_parametros'].sudo().search([('x_active', '=', True)], limit=1)

meses_regular = MESES_REGULAR_PADRAO
meses_inativo = MESES_INATIVO_PADRAO

if param and 'x_studio_meses_regular' in campos_param and param.x_studio_meses_regular:
    meses_regular = int(param.x_studio_meses_regular)
if param and 'x_studio_meses_inativo' in campos_param and param.x_studio_meses_inativo:
    meses_inativo = int(param.x_studio_meses_inativo)

# Um zero ou um negativo aqui classificaria todo mundo de uma vez só. Um
# número absurdo varreria a base inteira. Os limites não são preciosismo:
# o campo é editável por quem não escreveu isto.
if meses_regular < 1 or meses_regular > 24:
    meses_regular = MESES_REGULAR_PADRAO
if meses_inativo < 1 or meses_inativo > 24:
    meses_inativo = MESES_INATIVO_PADRAO

# ── Os meses que interessam, como 'AAAA-MM' ─────────────────────────────────
hoje = datetime.date.today()
mes_zero = hoje.replace(day=1)

meses_para_regular = []
i = 1
while i <= meses_regular:
    d = mes_zero - dateutil.relativedelta.relativedelta(months=i)
    meses_para_regular.append('%04d-%02d' % (d.year, d.month))
    i += 1

janela = []
i = 0
while i < meses_inativo:
    d = mes_zero - dateutil.relativedelta.relativedelta(months=i)
    janela.append('%04d-%02d' % (d.year, d.month))
    i += 1

# O corte da consulta é o mais antigo dos dois conjuntos.
mais_antigo = mes_zero - dateutil.relativedelta.relativedelta(
    months=max(meses_regular, meses_inativo))
corte = '%04d-%02d-01' % (mais_antigo.year, mais_antigo.month)

# ── Uma leitura só, para todo mundo ─────────────────────────────────────────
# Só dízimo: oferta é contribuição avulsa e não diz nada sobre regularidade.
# O filtro de tipo só entra se o campo existir — a base já rodou sem ele.
dominio = [
    ('x_studio_dizimista', '!=', False),
    ('x_studio_data_da_devolucao', '>=', corte),
]
if 'x_studio_tipo_contribuicao' in env['x_devolucao']._fields:
    dominio.append(('x_studio_tipo_contribuicao', '=', 'dizimo'))

linhas = env['x_devolucao'].sudo().search_read(
    dominio, ['x_studio_dizimista', 'x_studio_data_da_devolucao'])

meses_por_pessoa = {}
for linha in linhas:
    ref = linha['x_studio_dizimista']
    if not ref:
        continue
    pid = ref[0]
    data = linha['x_studio_data_da_devolucao']
    if not data:
        continue
    mes = str(data)[:7]
    if pid not in meses_por_pessoa:
        meses_por_pessoa[pid] = {}
    meses_por_pessoa[pid][mes] = True

# ── Classificação ───────────────────────────────────────────────────────────
baldes = {'Regular': [], 'Eventual': [], 'Inativo': []}
inalterados = 0

for dz in env['x_dizimista'].sudo().search([('x_active', '=', True)]):
    meses = meses_por_pessoa.get(dz.id, {})

    todos_os_meses = True
    for m in meses_para_regular:
        if m not in meses:
            todos_os_meses = False
            break

    algum_na_janela = False
    for m in janela:
        if m in meses:
            algum_na_janela = True
            break

    if todos_os_meses:
        novo = 'Regular'
    elif algum_na_janela:
        novo = 'Eventual'
    else:
        # A guarda do recém-cadastrado: sem devolução E cadastrado dentro da
        # janela não é abandono, é falta de tempo. Deixa como está.
        cadastro = dz.x_studio_data_cadastro if 'x_studio_data_cadastro' in dz._fields else False
        if cadastro and str(cadastro)[:7] in janela:
            inalterados += 1
            continue
        novo = 'Inativo'

    if dz.x_studio_classificacao == novo:
        inalterados += 1
    else:
        baldes[novo].append(dz.id)

# ── Gravação, em três writes no máximo ──────────────────────────────────────
for rotulo in ['Regular', 'Eventual', 'Inativo']:
    ids = baldes[rotulo]
    if ids:
        env['x_dizimista'].sudo().browse(ids).write({'x_studio_classificacao': rotulo})

log('Classificacao: N=%d M=%d | Regular +%d, Eventual +%d, Inativo +%d, sem mudanca %d' % (
    meses_regular, meses_inativo,
    len(baldes['Regular']), len(baldes['Eventual']), len(baldes['Inativo']),
    inalterados))
