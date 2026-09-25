# -*- coding: utf-8 -*-
"""
Testa classificar-dizimistas.py executando o ARQUIVO DE VERDADE contra um Odoo
de mentira. Não é uma cópia da regra — é a regra, rodando.

    python3 ferramentas/odoo-acoes/teste-classificar.py

Vale porque a ação só existe dentro do Odoo, onde não dá para depurar: erro de
lógica ali reclassifica 508 pessoas em silêncio, e "Inativo" é um rótulo que a
secretaria lê como "desistiu".
"""
import datetime as _dt
import io
import os
import sys

import dateutil.relativedelta as _rd


class Rec(object):
    """Um registro do Odoo, o suficiente para esta ação."""
    def __init__(self, campos):
        self._dados = dict(campos)
        self._fields = {k: True for k in campos}

    def __getattr__(self, nome):
        if nome.startswith('_'):
            raise AttributeError(nome)
        return self._dados.get(nome, False)

    def __bool__(self):
        return True
    __nonzero__ = __bool__


class Conjunto(object):
    def __init__(self, modelo, registros, campos_modelo, escritas):
        self._m, self._r, self._f, self._w = modelo, registros, campos_modelo, escritas
        self._fields = campos_modelo

    def sudo(self):
        return self

    def search(self, dominio, limit=None):
        # Os domínios desta ação são simples: só x_active = True.
        achados = [r for r in self._r if r._dados.get('x_active', True)]
        if limit:
            achados = achados[:limit]
        return achados[0] if (limit == 1 and achados) else Conjunto(self._m, achados, self._f, self._w)

    def search_read(self, dominio, campos):
        corte = next((c[2] for c in dominio if c[0] == 'x_studio_data_da_devolucao'), '0000-00-00')
        tipo = next((c[2] for c in dominio if c[0] == 'x_studio_tipo_contribuicao'), None)
        saida = []
        for r in self._r:
            if str(r._dados.get('x_studio_data_da_devolucao', '')) < corte:
                continue
            if tipo and r._dados.get('x_studio_tipo_contribuicao') != tipo:
                continue
            saida.append({c: r._dados.get(c, False) for c in campos})
        return saida

    def browse(self, ids):
        return Conjunto(self._m, [r for r in self._r if r._dados.get('id') in ids], self._f, self._w)

    def write(self, valores):
        for r in self._r:
            self._w.append((r._dados.get('id'), valores))
            r._dados.update(valores)
        return True

    def __iter__(self):
        return iter(self._r)


def rodar(parametros, devolucoes, dizimistas):
    escritas = []
    CAMPOS_DEV = {'x_studio_dizimista': 1, 'x_studio_data_da_devolucao': 1,
                  'x_studio_tipo_contribuicao': 1}
    CAMPOS_DZ = {'x_studio_classificacao': 1, 'x_studio_data_cadastro': 1, 'x_active': 1}
    tabelas = {
        'x_parametros':  Conjunto('x_parametros', [Rec(parametros)] if parametros else [],
                                  dict(parametros or {}), escritas),
        'x_devolucao':   Conjunto('x_devolucao', [Rec(d) for d in devolucoes], CAMPOS_DEV, escritas),
        'x_dizimista':   Conjunto('x_dizimista', [Rec(d) for d in dizimistas], CAMPOS_DZ, escritas),
    }
    contexto = {
        'env': tabelas,
        'datetime': _dt,
        'dateutil': type('d', (), {'relativedelta': _rd})(),
        'log': lambda *a, **k: None,
    }
    fonte = io.open(os.path.join(os.path.dirname(__file__), 'classificar-dizimistas.py'),
                    encoding='utf-8').read()
    exec(compile(fonte, 'classificar-dizimistas.py', 'exec'), contexto)
    return {i: v['x_studio_classificacao'] for i, v in escritas}


# ── Cenários ────────────────────────────────────────────────────────────────
hoje = _dt.date.today()
mes = hoje.replace(day=1)
def m(n):
    """Uma data dentro do mês n meses atrás. n=0 é o mês corrente."""
    d = mes - _rd.relativedelta(months=n)
    return '%04d-%02d-10' % (d.year, d.month)

DEV = lambda pid, n: {'x_studio_dizimista': (pid, 'x'),
                      'x_studio_data_da_devolucao': m(n),
                      'x_studio_tipo_contribuicao': 'dizimo'}

CASOS = [
    ('devolveu nos 3 meses fechados -> Regular',
     [DEV(1, 1), DEV(1, 2), DEV(1, 3)],
     [{'id': 1, 'x_studio_classificacao': 'Inativo'}], {1: 'Regular'}),

    ('so o mes corrente -> Eventual (o mes aberto nao exige, mas conta a favor)',
     [DEV(2, 0)],
     [{'id': 2, 'x_studio_classificacao': 'Inativo'}], {2: 'Eventual'}),

    ('furou um mes do meio -> Eventual, nao Regular',
     [DEV(3, 1), DEV(3, 3)],
     [{'id': 3, 'x_studio_classificacao': 'Regular'}], {3: 'Eventual'}),

    ('ultima devolucao ha 4 meses -> Inativo',
     [DEV(4, 4)],
     [{'id': 4, 'x_studio_classificacao': 'Regular'}], {4: 'Inativo'}),

    ('nunca devolveu, cadastrado ESTE mes -> nao mexe',
     [],
     [{'id': 5, 'x_studio_classificacao': 'Eventual',
       'x_studio_data_cadastro': m(0)}], {}),

    ('nunca devolveu, cadastrado ha um ano -> Inativo',
     [],
     [{'id': 6, 'x_studio_classificacao': 'Eventual',
       'x_studio_data_cadastro': m(12)}], {6: 'Inativo'}),

    ('ja era Regular e continua -> nenhuma escrita',
     [DEV(7, 1), DEV(7, 2), DEV(7, 3)],
     [{'id': 7, 'x_studio_classificacao': 'Regular'}], {}),

    ('oferta nao conta para regularidade',
     [dict(DEV(8, 1), x_studio_tipo_contribuicao='oferta'),
      dict(DEV(8, 2), x_studio_tipo_contribuicao='oferta'),
      dict(DEV(8, 3), x_studio_tipo_contribuicao='oferta')],
     [{'id': 8, 'x_studio_classificacao': 'Regular',
       'x_studio_data_cadastro': m(12)}], {8: 'Inativo'}),

    ('arquivado nao e classificado',
     [], [{'id': 9, 'x_studio_classificacao': 'Regular',
           'x_active': False, 'x_studio_data_cadastro': m(12)}], {}),
]

falhas = 0
for nome, devs, dzs, esperado in CASOS:
    obtido = rodar({'x_active': True}, devs, dzs)
    ok = obtido == esperado
    if not ok:
        falhas += 1
    print(('OK   ' if ok else 'FALHA') + '  ' + nome)
    if not ok:
        print('        esperava %r, veio %r' % (esperado, obtido))

# Parâmetro fora da faixa não pode reclassificar a base inteira.
for valor, rotulo in [(0, 'zero'), (-1, 'negativo'), (999, 'absurdo')]:
    obtido = rodar({'x_active': True, 'x_studio_meses_regular': valor,
                    'x_studio_meses_inativo': valor},
                   [DEV(1, 1), DEV(1, 2), DEV(1, 3)],
                   [{'id': 1, 'x_studio_classificacao': 'Inativo'}])
    ok = obtido == {1: 'Regular'}
    if not ok:
        falhas += 1
    print(('OK   ' if ok else 'FALHA') + '  parametro %s cai no padrao' % rotulo)

# E um parâmetro válido MUDA a regra de verdade.
obtido = rodar({'x_active': True, 'x_studio_meses_regular': 2, 'x_studio_meses_inativo': 2},
               [DEV(1, 1), DEV(1, 2)],
               [{'id': 1, 'x_studio_classificacao': 'Inativo'}])
ok = obtido == {1: 'Regular'}
if not ok:
    falhas += 1
print(('OK   ' if ok else 'FALHA') + '  com N=2, dois meses fechados bastam')

print('')
print(('%d falha(s)' % falhas) if falhas else 'tudo certo')
sys.exit(1 if falhas else 0)
