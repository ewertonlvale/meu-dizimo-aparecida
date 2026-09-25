# -*- coding: utf-8 -*-
"""
Testa atualizar-aniversarios.py executando o ARQUIVO DE VERDADE contra um Odoo
de mentira. Não é uma cópia da regra — é a regra, rodando.

    python3 ferramentas/odoo-acoes/teste-aniversarios.py

Vale porque a ação só existe dentro do Odoo, onde não dá para depurar. E
porque o modo de falhar aqui é mudo: um calendário vazio não parece quebrado,
parece que ninguém faz aniversário.
"""
import ast
import datetime as _dt
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = os.path.join(AQUI, 'atualizar-aniversarios.py')


class Rec(object):
    def __init__(self, id_, nasc, aniv=None):
        self.id = id_
        self.x_studio_date = nasc
        self.x_studio_aniversario = aniv


class Conjunto(object):
    def __init__(self, registros, escritas):
        self._r, self._w = registros, escritas

    def sudo(self):
        return self

    def search(self, dominio):
        # O único domínio da ação é x_studio_date != False.
        return Conjunto([r for r in self._r if r.x_studio_date], self._w)

    def browse(self, ids):
        return Conjunto([r for r in self._r if r.id in ids], self._w)

    def write(self, vals):
        self._w.append((sorted(r.id for r in self._r), dict(vals)))
        for r in self._r:
            for k in vals:
                setattr(r, k, vals[k])
        return True

    def __len__(self):
        return len(self._r)

    def __iter__(self):
        return iter(self._r)


class Env(object):
    def __init__(self, registros, campos, escritas):
        self._r, self._c, self._w = registros, campos, escritas

    def __getitem__(self, modelo):
        c = Conjunto(self._r, self._w)
        c._fields = self._c
        return c


class DataFalsa(_dt.date):
    """datetime.date com um `today()` que eu escolho."""
    HOJE = _dt.date(2026, 9, 22)

    @classmethod
    def today(cls):
        return cls.HOJE


def roda(registros, campos, hoje):
    """Executa o arquivo de verdade e devolve (escritas, linhas de log)."""
    DataFalsa.HOJE = hoje
    escritas, registrado = [], []

    modulo_datetime = type(sys)('datetime')
    modulo_datetime.date = DataFalsa
    modulo_datetime.datetime = _dt.datetime
    modulo_datetime.timedelta = _dt.timedelta

    contexto = {
        'env': Env(registros, campos, escritas),
        'datetime': modulo_datetime,
        'log': lambda m, **k: registrado.append(m),
    }
    exec(compile(open(FONTE).read(), FONTE, 'exec'), contexto)
    return escritas, registrado


COM_CAMPO = {'x_studio_date': True, 'x_studio_aniversario': True}
falhas = 0


def confere(nome, ok, detalhe=''):
    global falhas
    if not ok:
        falhas += 1
    print(('%s %s' % ('✅' if ok else '❌', nome)) + ('' if ok else '  ' + detalhe))


print('\n' + '─' * 64)
print('\U0001f382 Aniversários: o arquivo de verdade, rodando\n')

# 1. O caso comum
regs = [Rec(1, _dt.date(1975, 3, 14)), Rec(2, _dt.date(1982, 11, 2))]
esc, _ = roda(regs, COM_CAMPO, _dt.date(2026, 9, 22))
confere('data de nascimento vira a mesma data no ano corrente',
        regs[0].x_studio_aniversario == _dt.date(2026, 3, 14)
        and regs[1].x_studio_aniversario == _dt.date(2026, 11, 2),
        repr([r.x_studio_aniversario for r in regs]))

# 2. Rodar de novo no mesmo ano não escreve nada — é o custo dos 364 dias
esc, _ = roda(regs, COM_CAMPO, _dt.date(2026, 9, 23))
confere('segunda execução no mesmo ano não escreve nada', esc == [], repr(esc))

# 3. A virada do ano
esc, _ = roda(regs, COM_CAMPO, _dt.date(2027, 1, 1))
confere('em 1º de janeiro todo mundo muda de ano',
        regs[0].x_studio_aniversario == _dt.date(2027, 3, 14)
        and regs[1].x_studio_aniversario == _dt.date(2027, 11, 2),
        repr([r.x_studio_aniversario for r in regs]))

# 4. 29 de fevereiro — o caso que derrubaria a ação inteira
bissexto = [Rec(1, _dt.date(1976, 2, 29)), Rec(2, _dt.date(1990, 5, 10))]
esc, _ = roda(bissexto, COM_CAMPO, _dt.date(2027, 6, 1))   # 2027 não é bissexto
confere('nascido em 29/02 cai em 28/02 em ano não bissexto',
        bissexto[0].x_studio_aniversario == _dt.date(2027, 2, 28),
        repr(bissexto[0].x_studio_aniversario))
confere('e não derruba quem vem depois dele na lista',
        bissexto[1].x_studio_aniversario == _dt.date(2027, 5, 10),
        repr(bissexto[1].x_studio_aniversario))

bissexto2 = [Rec(1, _dt.date(1976, 2, 29))]
roda(bissexto2, COM_CAMPO, _dt.date(2028, 6, 1))           # 2028 é bissexto
confere('em ano bissexto ele volta para 29/02',
        bissexto2[0].x_studio_aniversario == _dt.date(2028, 2, 29),
        repr(bissexto2[0].x_studio_aniversario))

# 5. Sem data de nascimento não entra
sem = [Rec(1, None), Rec(2, _dt.date(2000, 7, 4))]
esc, _ = roda(sem, COM_CAMPO, _dt.date(2026, 9, 22))
confere('quem não tem data de nascimento fica de fora',
        sem[0].x_studio_aniversario is None
        and sem[1].x_studio_aniversario == _dt.date(2026, 7, 4),
        repr([r.x_studio_aniversario for r in sem]))

# 6. Aniversários iguais viram UMA escrita só
juntos = [Rec(1, _dt.date(1970, 4, 9)), Rec(2, _dt.date(1988, 4, 9)), Rec(3, _dt.date(1995, 4, 9))]
esc, _ = roda(juntos, COM_CAMPO, _dt.date(2026, 9, 22))
confere('três pessoas do mesmo dia gastam uma escrita, não três',
        len(esc) == 1 and esc[0][0] == [1, 2, 3], repr(esc))

# 7. Sem o campo, avisa e não explode
esc, logs = roda([Rec(1, _dt.date(1975, 3, 14))], {'x_studio_date': True}, _dt.date(2026, 9, 22))
confere('sem o campo instalado, avisa no log em vez de estourar',
        esc == [] and any('instalar-aniversarios' in l for l in logs), repr(logs))

# 8. O log diz o que aconteceu
esc, logs = roda([Rec(1, _dt.date(1975, 3, 14))], COM_CAMPO, _dt.date(2026, 9, 22))
confere('o log traz ano, quantos têm data e quantos mudaram',
        logs and '2026' in logs[0] and '1 atualizado' in logs[0], repr(logs))

# 9. A DATA DE NASCIMENTO NUNCA É ESCRITA.
#
#    Esta ação varre os 508 dizimistas todo dia. Se um dia ela passar a gravar
#    em x_studio_date — por um CAMPO trocado, por um copiar-e-colar de outra
#    ação — o estrago é a base inteira de datas de nascimento, sem volta e sem
#    nada acusando. É a garantia mais cara deste arquivo, então é a que fica
#    conferida em vez de combinada.
misto = [Rec(1, _dt.date(1975, 3, 14)), Rec(2, _dt.date(1976, 2, 29)), Rec(3, None)]
nascimentos_antes = [r.x_studio_date for r in misto]

campos_escritos = set()
for hoje in (_dt.date(2026, 9, 22), _dt.date(2027, 1, 1), _dt.date(2028, 3, 5)):
    esc, _ = roda(misto, COM_CAMPO, hoje)
    for _ids, vals in esc:
        campos_escritos |= set(vals)

confere('a ação só escreve em x_studio_aniversario',
        campos_escritos == {'x_studio_aniversario'}, repr(sorted(campos_escritos)))
confere('as datas de nascimento saem intactas de três execuções',
        [r.x_studio_date for r in misto] == nascimentos_antes,
        repr([r.x_studio_date for r in misto]))

# A mesma garantia, lida direto da fonte: vale também para um caminho que estes
# cenários não exercitem.
_escritas = [n for n in ast.walk(ast.parse(open(FONTE).read()))
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == 'write']
_citam = [ast.dump(c)[:80] for c in _escritas if 'x_studio_date' in ast.dump(c)]
confere('nenhuma chamada a write() no arquivo cita x_studio_date',
        bool(_escritas) and not _citam, repr(_citam))

print('\n' + '─' * 64)
if falhas:
    print('❌ %d verificação(ões) fora do esperado.\n' % falhas)
    sys.exit(1)
print('✅ A ação de aniversários faz o que diz.\n')
