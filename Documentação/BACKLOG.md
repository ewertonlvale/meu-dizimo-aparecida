# Backlog — Bot Meu Dízimo (meu-dizimo-aparecida)

**Criado em:** 14/09/2026
**Base:** revisão do código-fonte `.gs` (ver [ANALISE-GERAL.md](historico/ANALISE-GERAL.md), arquivada) + análise de concorrência/carga.
**Atualizado em:** 17/09/2026 — **auditoria do código** conferindo cada item marcado como concluído contra os `.gs` (ver "Auditoria de 17/09/2026"). Resultado: adicionado BL-27, BL-26 reclassificado para parcial, BL-22 elevado a 🟠 e registrada a inversão de sequência do BL-01.
**Atualizado em:** 14/09/2026 — adicionados BL-26 e refino do BL-14 a partir de uma **simulação real** (cadastro + devolução) capturada do WhatsApp.
**Progresso:** Sprints 1 e 2 concluídas na `main`, mais BL-09 e BL-11. Em 17/09 fecharam BL-22, BL-23, BL-24, BL-26 e BL-27, e o BL-17 ficou pela metade (webhook fail-closed; falta o uid dedicado no Odoo).
**Atualizado em:** 18/09/2026 — ciclo do WhatsApp Flow: BL-30 a BL-33, mais uma refatoração do diff acumulado (quatro revisões independentes: reuso, simplificação, eficiência e altitude). Depois, a documentação de custo (`Documentação/FLUXOS.md`) e os três itens que ela motivou: **BL-38** (entrada: 4 → 2 mensagens), **BL-37** (devolução: 6 → 3) e **BL-39** (cadastro duplicado). A conta mensal projetada caiu de R$ 87,50 para **R$ 35,00**. Em 19/09, o **BL-40** registrou a pesquisa do card de pagamento nativo do WhatsApp, com a sonda pronta para rodar.
**Pendências:** **BL-29** ficou parcial: o lote agrupado foi consertado (ordenação por `timestamp`) e o atropelo entre POSTs separados é detectado e recusado, mas o `timestamp` do WhatsApp tem granularidade de 1 s e mensagens do mesmo segundo continuam indistinguíveis. O caminho para o resto não é mais código de ordenação — é o cadastro por formulário (BL-33, pronto) e a redução do tempo de execução (BL-21). O BL-29 é o mais relevante: mensagens processadas fora de ordem gravam a resposta no campo errado, em silêncio — e a janela do problema é proporcional à duração da execução, o que o amarra ao BL-21. **BL-21** ficou parcial por decisão técnica — o tempo de execução caiu, mas a fila assíncrona foi avaliada e **descartada** (não cabe nos limites do Apps Script; ver análise no item), então o teto de execuções simultâneas continua de pé **com o BL-01 em produção** (ver nota no BL-01). A metade aberta do **BL-17** (uid Odoo dedicado) é tarefa de administração no Odoo — roteiro passo a passo no item.
⚠️ **Uma ação fora do código:** criar o usuário Odoo dedicado (BL-17). O `criarCampoConferenciaPix()` do BL-26 **já foi rodado** — confirmado em 18/09 no dump do schema (gerado por `ferramentas/odoo-dump.mjs`; o JSON não fica versionado): `x_studio_conferencia_pix` existe em `x_devolucao`, tipo `char`, store. E, como sempre, as correções só valem no bot após `clasp push` + republicação do deployment (ver observação no fim).
**Como usar:** cada item tem um ID (`BL-NN`), severidade, esforço estimado, arquivo(s), proposta de correção e critério de aceite. Priorize de cima para baixo.
**Escopo deste arquivo:** é um **registro de trabalho** — o que foi encontrado, decidido e por quê. Para *como o sistema funciona hoje* e as regras a respeitar ao mexer no código (armazenamento, chamadas externas, concorrência, publicação), veja **[ARQUITETURA.md](ARQUITETURA.md)**.

## Legenda

| Severidade | Significado |
|---|---|
| 🔴 Crítica | Quebra função essencial ou corrompe dado financeiro / confiança do usuário |
| 🟠 Média | Falha em cenário comum ou degrada a experiência |
| 🟡 Baixa | Manutenção, cosmético ou risco apenas latente |

**Esforço:** P = pequeno (< 1h) · M = médio (algumas horas) · G = grande (≥ 1 dia).

---

## Tabela-resumo

| ID | Título | Sev. | Esforço | Status |
|----|--------|------|---------|--------|
| BL-01 | Notificações mensais quebradas (`OdooService.executar` inexistente) | 🔴 | M | ✅ Concluído (+ fail-open, fix `date`, repescagem, botão do template) — ⚠️ **em produção sem BL-21/BL-24**, contrariando a ordem do Sprint 3 |
| BL-02 | Confirmação falsa de devolução quando registro no Odoo falha | 🔴 | P | ✅ Concluído |
| BL-03 | Sessão promete 60 min mas expira em 15 (valores de teste) | 🔴 | P | ✅ Concluído (60 min; aviso em 50) |
| BL-04 | Lista de comunidades estoura limite de 10 rows do WhatsApp | 🔴 | P | ✅ Concluído (paginação "Ver mais") |
| BL-26 | Comprovante não é validado contra a chave PIX/destinatário da comunidade | 🔴 | M | ✅ Concluído — campo estruturado + alerta ao coordenador (17/09). Campo confirmado no Odoo em 18/09 |
| BL-27 | Fallback de PDF aceita qualquer arquivo como comprovante (contorna o BL-26) | 🔴 | P | ✅ Concluído — fallback removido; PDF ilegível pede reenvio e não registra nada |
| BL-05 | Devoluções do bot podem não aparecer em "Pendentes" (comunidade não gravada) | 🟠 | P | ✅ Fechado — `x_studio_comunidade` é related de `x_studio_dizimista.x_studio_comunidade` (stored/readonly); confirmado no schema e em produção |
| BL-06 | Parse de valor mensal quebra com separador de milhar | 🟠 | P | ✅ Concluído |
| BL-07 | `AGUARDANDO_COMPROVANTE` setado mesmo sem dados de pagamento | 🟠 | P | ✅ Concluído |
| BL-08 | Validação de data de nascimento aceita datas impossíveis/futuras | 🟠 | P | ✅ Concluído |
| BL-09 | Webhook processa só a 1ª mensagem do lote | 🟠 | M | ✅ Concluído (loop entry/changes/messages + idempotência por messageId) |
| BL-10 | Atalhos globais (menu/0/rel) abortam o cadastro sem confirmação | 🟠 | P | ✅ Concluído |
| BL-11 | Payload PIX (BR Code) com tag 54 inválida, dados fixos e vazamento a terceiro | 🟠 | M | ✅ Payload corrigido (tag 54 condicional, nome/cidade do titular, tag 62, copia-e-cola). QR externo mantido por decisão (chave não é secreta, baixo risco) |
| BL-28 | Resposta interativa fora de contexto aborta o cadastro em silêncio | 🟠 | P | ✅ Concluído (18/09) — o cadastro vence o toque fora de contexto; o passo é repetido |
| BL-29 | Mensagens processadas fora de ordem gravam a resposta no campo errado | 🟠 | G | ⚠️ Parcial (18/09) — lote ordenado (conserto) + portão por timestamp (mitigação). Resta o atropelo dentro do MESMO segundo |
| BL-12 | `ASSETS` não declarado — `getAvatar()` sempre falha | 🟡 | P | ✅ Concluído (objeto `ASSETS` declarado em Assets.gs) |
| BL-13 | Dados da secretaria com placeholder em produção | 🟡 | P | ✅ Resolvido — opção "Secretaria" virou "Contato Pastoral" (contato do responsável por comunidade; secretaria de `x_parametros` como fallback) |
| BL-14 | Extração frágil de valor e chave PIX do OCR (chave = fragmento do ID da transação) | 🟠 | M | ✅ Concluído |
| BL-15 | Efeito colateral: busca de dizimista atualiza telefone no Odoo | 🟡 | P | ✅ Concluído (removida a escrita durante a leitura; `x_studio_partner_phone` é related+gravável e propagava p/ res.partner) |
| BL-16 | Separar arquivos de teste do deploy de produção | 🟡 | M | ✅ Concluído — `.claspignore`; deploy caiu ~699 KB → ~281 KB (17/09) |
| BL-17 | Segurança: uid Odoo dedicado + `WEBHOOK_SECRET` obrigatório | 🟠 | M | ⚠️ Parcial — webhook agora é fail-closed (17/09); uid dedicado é tarefa de administração no Odoo, o código só alerta |
| **Concorrência / carga** | | | | |
| BL-20 | Race condition por usuário em `dados_`/`estado_` (sem lock) | 🟠 | M | ✅ Concluído (mitigação) |
| BL-21 | Teto de ~30 execuções simultâneas compartilhado por todos os usuários | 🟠 | G | ⚠️ Parcial — tempo de execução reduzido (17/09); a fila assíncrona foi **avaliada e descartada**, ver análise no item |
| BL-22 | Lock global de `sessoes_cadastro_ativas` é gargalo sob contenção | 🟠 | M | ✅ Concluído — lista única virou uma propriedade por sessão; sem lock (17/09) |
| BL-23 | Duplicação de `x_contato_bot` em primeiro contato simultâneo | 🟡 | P | ✅ Concluído (lock + dupla checagem no cache miss) |
| BL-24 | Sem retry/backoff em 429/5xx (WhatsApp, Odoo, Vision) | 🟡 | M | ✅ Concluído (`Utils.fetchComRetry`, com política por idempotência) |
| BL-25 | Cota diária de UrlFetch pode limitar volume total | 🟡 | P | ✅ Concluído — contagem diária + alerta em 60%/80% (17/09) |
| **WhatsApp Flow (18/09)** | | | | |
| BL-30 | Cadastro por WhatsApp Flow — 1 execução de coleta no lugar de 9 | 🟠 | M | ✅ Concluído (18/09) — entrada ligada pelo BL-33 |
| BL-31 | Webhook descartava os callbacks de entrega da Meta | 🟠 | P | ✅ Concluído — `_registrarStatusEntrega`; sem isso, "não chegou" ficava sem diagnóstico |
| BL-32 | Nono dígito: mensagem aceita com HTTP 200 e nunca entregue | 🟠 | P | ✅ Concluído — sugestão do número alternativo na falha + `auditarNumerosWhatsApp()`. Sem correção automática: é heurística |
| BL-33 | Ligar o Flow no cadastro (interruptor, foto após envio, membro da família) | 🟠 | G | ✅ Concluído (18/09) — inclui o formulário de membro, com endereço e dia pré-preenchidos |
| BL-12 · BL-13 · BL-15 | Itens baixos de manutenção | 🟡 | P | ✅ Confirmados resolvidos (19/09) — estavam feitos e não marcados |
| BL-14 | Extração frágil de valor e chave PIX do OCR | 🟠 | M | ✅ Concluído (19/09) — heurística já refeita; entraram os 6 testes de regressão que faltavam |
| BL-34 | Texto durante o formulário derruba para a conversa cedo demais | 🟡 | P | 📋 A decidir — falta dado de uso |
| BL-35 | Uma pessoa podia gerar cobrança sem limite mandando mensagem | 🟠 | P | ✅ Concluído (18/09) — 12/min e 60/h por número, ajustáveis por Properties |
| BL-36 | Lista de bloqueio de telefones + detecção automática de spam | 🟠 | M | ✅ Parte 1 (19/09) — lista + portão + administração. Detecção só MARCA; bloqueio automático depende de dado que não existe |
| BL-37 | Enxugar a devolução, o único fluxo recorrente | 🟠 | M | ✅ Concluído (18/09) — **6 → 3** mensagens; a conta cai 60% |
| BL-38 | Entrada do bot: boas-vindas unificada e menu decidido pelo número | 🟠 | M | ✅ Concluído (18/09) — 4 → 2 mensagens; 6 → 2 para quem já é dizimista |
| BL-39 | Cadastro duplicado: o mesmo número virava dois dizimistas | 🔴 | P | ✅ Concluído (18/09) — guarda no ponto de gravação, com lock |
| BL-40 | Card de pagamento nativo do WhatsApp (botão "Copiar código Pix") | 🟠 | M | ✅ **Implementado (19/09)** — devolução 3 → 2; código validado no app do banco. `order_status` ainda por medir |
| BL-42 | `Utils._mesAtual` chamada em 4 lugares e nunca definida | 🔴 | P | ✅ Corrigido (19/09) — a medição de consumo (BL-25) nunca funcionou em produção |
| BL-41 | Oferta como contribuição própria, aberta a não cadastrados | 🟠 | G | ✅ **Concluído (19/09)** — testado em produção de ponta a ponta. Migração feita, formulário publicado |
| BL-43 | O arnês de testes só roda quando o Claude está no meio do caminho | 🟡 | P | 📋 Aberto — **adiado por decisão do usuário em 19/09.** Falta uma GitHub Action |
| BL-44 | Cadastro e membro por conversa desligados: o formulário vira o único caminho | 🟠 | P | ✅ Concluído (19/09) — interruptor `CADASTRO_CONVERSA_ATIVO`, desligado por padrão. **Fecha o BL-34** |
| BL-45 | O botão "Corrigir" cancelava o cadastro e apagava os 7 campos | 🔴 | P | ✅ Concluído (19/09) — o formulário volta preenchido. ⚠️ **Exige republicar o Flow na Meta** |
| BL-46 | Conferir o comprovante contra o cadastro: nome, chave e banco | 🟠 | M | ✅ Concluído (19/09) — extração ancorada em quem RECEBEU; alerta só no totalmente divergente |
| BL-47 | Cartão de contato mostrava o mesmo telefone 2x, e o primeiro não abria | 🟡 | P | ✅ Concluído (19/09) — um número só, o provável para o DDD |
| BL-48 | BR Code levava a chave PIX com máscara, fora da especificação | 🔴 | P | ✅ Concluído (19/09) — CPF/CNPJ em dígitos, telefone em E.164. O BL-40 passou porque foi testado com e-mail |
| BL-49 | A chave extraída podia ser o CNPJ da instituição, no rodapé | 🔴 | P | ✅ Concluído (19/09) — busca ancorada no bloco de quem recebeu. 6 layouts reais viraram teste |
| BL-50 | Exibir quem recebeu, e oferecer a pastoral quando não confere | 🟠 | P | ✅ Concluído (19/09) — nome, chave, banco e valor no resumo; qualquer campo lido que divirja avisa |
| BL-51 | Devolução nascia sempre Pendente, mesmo quando o bot já sabia | 🟠 | P | ✅ Concluído (19/09) — Confirmado, Rejeitado ou Pendente conforme a conferência |
| BL-52 | A data só era lida em dd/mm/aaaa — Nubank e Google Pay passavam em branco | 🟠 | P | ✅ Concluído (20/09) — mês por extenso, ISO, ano de 2 dígitos e o ano vindo do E2E. Saída sempre normalizada |
| BL-53 | A oferta gravava o valor DIGITADO, nunca o do comprovante | 🔴 | P | ✅ Concluído (20/09) — vale o comprovante; oferta de R$ 10 paga com R$ 55 registrava R$ 10 |
| BL-54 | Endereço e mapa da comunidade | 🟡 | M | ✅ Código pronto (21/09) — via `res.partner`, com 5 campos relacionados e view de mapa. **Falta instalar** com `--aplicar` |
| BL-55 | Sete dos oito formulários do Odoo nunca foram revisados | 🟡 | M | 📋 Aberto — só `x_devolucao.form` foi. Quatro têm coluna direita vazia |
| BL-56 | Classificação do dizimista era campo manual que ninguém mantinha | 🟠 | M | ✅ Código pronto (21/09) — ação agendada do Odoo, versionada no repo. **Falta instalar** com `--aplicar` |
| BL-57 | O agrupamento "Mês Referencia" agrupa por um campo que o bot nunca grava | 🟡 | P | 📋 Aberto — `x_studio_competencia` só é lido, nunca escrito; todo registro do WhatsApp cai num balde "Nenhum" |
| BL-58 | O mapa de dizimista continua vazio: o campo que ele lê não está no formulário | 🟡 | P | 📋 Aberto — precisa antes saber se `x_studio_partner_phone` é relacionado através de `x_studio_partner_id` |
| BL-59 | Classificação feita à mão é desfeita pela ação agendada na madrugada seguinte | 🟡 | P | 📋 Aberto — o statusbar virou só-leitura (21/09) para o problema não ser silencioso |
| BL-60 | O coordenador não tinha onde registrar a conferência dele, separada da do bot | 🟠 | M | ✅ Código pronto (21/09) — campo `x_studio_validacao` e barra clicável. **Falta instalar** com `--aplicar` |
| BL-61 | O banner de conferência mostra o código cru (`ausente`, `sem_referencia`) | 🟡 | P | 📋 Aberto — o espaço já foi corrigido; falta humanizar os rótulos da seleção no Odoo |
| BL-62 | Dízimo do mês seguinte criado automaticamente, em estado Previsto | 🟠 | G | 📋 Desenho fechado (21/09) — mexe no `registrarDevolucao`, que é o caminho do dinheiro. PR próprio |
| BL-63 | O cadastro da comunidade pedia a imagem do QR Code, que o bot nunca leu | 🟡 | P | ✅ Concluído (21/09) — saiu da tela; o campo e as imagens continuam no Odoo |

---

## Ajustes no Odoo (adiados, com desenho fechado)

### BL-54 — Endereço e mapa da comunidade 🟡 (M)

**Pedido:** campos de endereço no cadastro da comunidade, e geolocalização para ver no mapa.

**Decisão de desenho (usuário, 21/09): via `res.partner`.** Um campo many2one de contato em
`x_comunidade`; o endereço é o padrão do Odoo e pode aparecer na tela da comunidade como
campos relacionados.

**Por que não é escolha de gosto.** O mapa do Odoo geolocaliza **através do `res.partner`** —
verificado na própria instância, no arch da view de mapa de dizimista:

```xml
<map res_partner="x_studio_partner_id">
```

Ele não lê latitude e longitude soltas num modelo qualquer. Campos de endereço próprios em
`x_comunidade` dariam a tela pedida e **nenhum mapa**.

**Atenção — a mesma dependência já morde o projeto:** o mapa de dizimista existe e vive vazio,
porque `x_studio_partner_id` nunca é preenchido (0 de 508). Criar o campo não basta; alguém
tem de povoá-lo. Para 6 comunidades isso é trabalho de uma tarde; para os dizimistas é o
achado A2/E da análise, ainda em aberto.

**O que falta decidir/verificar antes de executar:**
- se o módulo de geocodificação está disponível na instância (o mapa mostra pino; converter
  endereço em coordenada é outra coisa)
- se o endereço entra também no BR Code do PIX (hoje `MediaService._gerarPayloadPix` recebe
  cidade fixa)

**✅ Implementado em 21/09** — `ferramentas/instalar-endereco-comunidade.mjs`. Cria:

1. `x_studio_partner_id` (many2one `res.partner`) — o endereço de verdade, e o que o mapa lê
2. cinco campos **relacionados e editáveis**: rua, complemento/bairro, cidade, UF e CEP.
   Quem digita na tela da comunidade escreve no parceiro — o dado mora num lugar só,
   então não há duas cópias para manter em sincronia
3. a view de **mapa** de `x_comunidade`, que não existia
4. `map` no `view_mode` da ação — senão a view existe e ninguém a alcança

Simula por padrão; gravar exige `--aplicar`. Idempotente: rodar duas vezes não escreve nada
na segunda. Exercitado contra um Odoo simulado nas três situações (base limpa sem aplicar,
base limpa aplicando, tudo já instalado).

**⚠️ FALTA INSTALAR** — nada foi criado no Odoo:

```
node ferramentas/instalar-endereco-comunidade.mjs             # simula
node ferramentas/instalar-endereco-comunidade.mjs --aplicar   # grava
node ferramentas/baixar-views.mjs --download                  # versiona a view nova
```

**Depois, ainda falta:** pôr os campos no formulário de Comunidade (o `baixar-views --update`
faz, quando os campos existirem) e **preencher o endereço das 6 comunidades** — ver o aviso
acima.

---

### BL-56 — Classificação automática do dizimista 🟠 (M)

**Regra** (definida pelo usuário em 21/09, com uma precisão minha onde a frase era ambígua):

| Classificação | Critério |
|---|---|
| Regular | devolveu em CADA UM dos últimos **N** meses fechados |
| Eventual | devolveu ao menos uma vez na janela de **M** meses (mês atual incluído), mas não em todos os N |
| Inativo | nenhuma devolução na janela de **M** meses |

`N` e `M` são `x_studio_meses_regular` e `x_studio_meses_inativo` em `x_parametros`, padrão 3.

**"Mensalmente" virou "todos os N meses FECHADOS".** O mês corrente não é exigido de
propósito: dia 2 quase ninguém devolveu ainda, e cobrar o mês aberto rebaixaria a paróquia
inteira todo dia 1º e a promoveria de volta ao longo do mês. O mês corrente conta a favor
(evita Inativo), nunca contra.

**Quem acabou de se cadastrar não vira Inativo.** "Mais de 3 meses sem devolver" é falso para
quem existe há três semanas, e Inativo é um rótulo que a secretaria lê como "desistiu".

**Onde mora:** ação agendada do Odoo (`ir.cron`), diária — escolha do usuário. É também o
lugar certo: 508 dizimistas pelo Apps Script seriam 508 chamadas RPC contra o teto de 6
minutos por execução. Aqui é uma leitura só, do lado dos dados. Passa a ser a **primeira
automação dentro do Odoo** — até aqui eram zero (achado D1).

**O código é versionado:** `ferramentas/odoo-acoes/classificar-dizimistas.py`. Ação agendada
não tem histórico nem revisão (achado D3); manter a fonte no repo e instalar a partir dela
devolve as duas coisas. O instalador acusa divergência em vez de sobrescrever calado.

**Testado** com `python3 ferramentas/odoo-acoes/teste-classificar.py` — 13 cenários rodando o
arquivo de verdade contra um Odoo de mentira, não uma cópia da regra.

**⚠️ FALTA INSTALAR.** Nada foi criado no Odoo:

```
node ferramentas/instalar-acao-classificacao.mjs             # simula
node ferramentas/instalar-acao-classificacao.mjs --aplicar   # grava
```

**Depois de instalar, ainda falta:**
- pôr os dois campos no formulário de Parâmetros (o `baixar-views` faz, quando os campos
  existirem)
- decidir o que acontece quando um coordenador classifica alguém à mão: hoje a ação
  sobrescreve na próxima execução, sem perguntar

---

### BL-55 — Sete dos oito formulários nunca foram revisados 🟡 (M)

A revisão de 21/09 cobriu as **listas** e a **busca** de todos os modelos, mas dos oito
formulários só `x_devolucao.form` foi de fato revisado (PR #91).

| Formulário | Estado |
|---|---|
| `x_devolucao` | ✅ revisado e reescrito |
| `x_parametros` | ⚠️ só a tabela embutida de privilégios |
| `x_comunidade` | ✅ revisado (PR #102/#103) — endereço, mapa e alinhamento do `<group>` |
| `x_dizimista` | ✅ revisado (21/09) — colunas reequilibradas, grupos vazios removidos, devoluções em aba |
| `x_contato_bot`, `x_notificacao_log`, `x_parametros_line_c498a`, `res.users` | ❌ não revisados |

**O ganho conhecido:** pelo menos quatro delas têm a **coluna direita vazia**, o mesmo defeito
que em devolução deixava o comprovante abaixo da dobra. O `x_parametros_line_c498a.form` é
literalmente só `x_name` — os quatro campos da linha de privilégio não têm tela própria.

**Risco a lembrar:** formulário é a view mais estrutural para mexer por xpath, e a de
devolução só foi segura porque os quatro âncoras foram conferidos contra a view base
versionada. Fazer uma por vez, com `--update --simular` antes.

---

### BL-57 — "Mês Referencia" agrupa por um campo vazio 🟡 (P)

O menu **Agrupar por → Mês Referencia** de `x_devolucao` usa `x_studio_competencia`.
Esse campo aparece uma única vez no código do bot, em `OdooService.gs:1024`, e é uma
**leitura**: `buscarDevolucaoDetalhada` o traz para a tela de detalhe. Nenhum caminho
o escreve.

Como praticamente toda devolução nasce pelo WhatsApp, o agrupamento devolve um balde
"Nenhum" com tudo dentro. Quem clica nele conclui que o agrupamento está quebrado — e
está, só que a causa é o dado, não a view.

**Duas saídas, e a escolha é da paróquia:**
1. O bot passa a gravar a competência no momento da devolução (o mês da data da
   devolução, ou o mês que a pessoa disser). Aí o agrupamento vale.
2. O agrupamento sai do menu, e "Mês Atual" mais o filtro de data cobrem o uso.

Enquanto não se decide, o item fica no menu — tirar uma opção que alguém pode estar
preenchendo à mão é pior que deixá-la com aviso no arch.

---

### BL-58 — O mapa de dizimista lê um campo que não está no formulário 🟡 (P)

`x_dizimista.map` geolocaliza por `<map res_partner="x_studio_partner_id">`. Só que o
formulário do dizimista **não mostra esse campo**: a view do Studio o removia com
`position="replace"`, trocando-o por nome completo e CPF. Não havia, pela tela, como
preencher o que o mapa lê. Daí os 0 de 508.

**O que precisa ser respondido antes de mexer:** `x_studio_partner_phone` é um campo
próprio de `x_dizimista`, ou é *relacionado* através de `x_studio_partner_id`, como o
nome sugere e como o arch base insinua (os três `partner_*` vinham em sequência logo
depois dele)? Se for relacionado, o telefone não poderia estar preenchido com o
parceiro vazio — e o bot demonstravelmente usa telefone. Ou seja: ou o parceiro está
preenchido e os 0 de 508 têm outra explicação, ou o campo é solto e só tem nome de
relacionado.

A resposta sai de uma leitura de `ir.model.fields` (`related`, `store`) para
`x_dizimista`. **Sem ela, não dá para desenhar a correção**, e por isso o campo não foi
devolvido ao formulário na revisão de 21/09: pôr na tela do coordenador um campo cujo
significado não se conhece é pior que a tela sem ele.

Fechado isso, o caminho é o mesmo do BL-54 na comunidade: parceiro + campos
relacionados editáveis, e o endereço passando a morar num lugar só.

---

### BL-59 — Classificação manual é desfeita na madrugada seguinte 🟡 (P)

A ação agendada do BL-56 reescreve `x_studio_classificacao` de todos os dizimistas todo
dia. Enquanto o statusbar do formulário estava `clickable`, um coordenador podia mudar a
classificação à mão, ver a mudança valer, e encontrá-la desfeita no dia seguinte sem
aviso nem rastro.

**Feito em 21/09:** o statusbar virou só-leitura, com `help` dizendo que o cálculo é
diário. O problema deixou de ser silencioso — mas a necessidade, se existir, deixou de
ser atendida.

**Se a paróquia precisar mesmo decidir caso a caso**, o desenho é um campo de exceção
(`x_studio_classificacao_manual`, com data e motivo) que a ação agendada respeite e não
sobrescreva — e não destravar o statusbar. Destravado, o conflito volta a ser invisível.

---

### BL-60 — A validação do coordenador 🟠 (M)

**O problema:** `x_studio_status` carregava a leitura do bot (BL-51) e era clicável.
Quem quisesse registrar que o dinheiro entrou passava por cima dela — e "Confirmado"
deixava de dizer quem confirmou. É a mesma forma do BL-59.

São dois julgamentos, de dois autores, sobre coisas diferentes:

| campo | quem decide | sobre o quê |
|---|---|---|
| `x_studio_status` | o bot, no ato do registro | o comprovante bate com a comunidade |
| `x_studio_validacao` | o coordenador | o dinheiro entrou na conta |

O que interessa à paróquia é justamente a **linha em que os dois discordam** — bot diz
Confirmado, coordenador diz Não recebido. Essa linha só existe se os dois estiverem à
vista, então as duas colunas ficam juntas na lista.

**Feito em 21/09:**
- `ferramentas/instalar-validacao-devolucao.mjs` cria o campo (`A validar` → `Validado` /
  `Não recebido`), o padrão e marca as devoluções existentes como `A validar`
- A barra de status do topo do formulário passou a ser a da validação, clicável; a leitura
  do bot desceu para uma linha logo abaixo, como badge só-leitura
- Coluna e filtros na lista e na busca

**Por que barra de status e não o botão "Validar" que foi pedido:** botão de header no
Odoo Online chama uma `ir.actions.server` por **ID numérico**, e esse ID só nasce no
`--aplicar`. O arquivo versionado da view não teria como carregá-lo, e cada `--update`
quebraria o botão. A barra clicável é view pura — e dá os três estados nomeados num
clique, em vez de um botão com um destino só.

**Quem validou e quando:** o campo nasce com `tracking` e `x_devolucao` tem chatter, então
cada mudança vira uma linha no histórico do registro, com autor e horário. Dois campos a
menos para manter, e um histórico em vez de um instante.

**Aberto neste item:** nada impede um coordenador de validar devolução de outra
comunidade. Resolver isso é uma *record rule* ligada a `x_studio_coordenador`, e depende
de esse campo ser um `res.users` — o que ainda não foi verificado (mesma pendência do
BL-58).

---

### BL-61 — O banner de conferência mostra o código cru 🟡 (P)

O banner do formulário de devolução exibe o valor de `x_studio_conferencia_pix` como ele é
gravado: `ausente`, `sem_referencia`, `titular_divergente`. Quem lê é o coordenador, e
"Precisa de conferência: sem_referencia" não diz o que fazer.

O texto humano **já existe**, em `Config.gs`, na tabela `CONFERENCIA` — o campo
`textoCoordenador` de cada código ("não consegui identificar a chave no comprovante", "a
comunidade não tem chave PIX cadastrada para comparar"). Ele é usado nas mensagens de
WhatsApp e não chega ao Odoo.

**A correção é do lado do Odoo, não da view:** os rótulos da seleção
`x_studio_conferencia_pix` precisam receber esses textos. Um script na forma dos outros
instaladores resolve, e ganha de graça a lista e os filtros, que mostram o mesmo código.

*Corrigido em 21/09:* o espaço que faltava depois dos dois-pontos — saía
"Precisa de conferência:ausente", colado.

---

### BL-62 — Dízimo do mês seguinte, criado automaticamente 🟠 (G)

**Desenho fechado com o pároco em 21/09.** Falta implementar.

Quando uma devolução de dízimo é registrada, nasce junto o registro do **mês seguinte** em
estado `Previsto` — sem valor, sem data, sem comprovante. Quando o pagamento daquele mês
chega, o bot **preenche o Previsto** em vez de criar um segundo registro.

**Decisões tomadas:**

1. *Quem ganha Previsto:* só quem pagou, no ato do registro. A alternativa — uma ação
   mensal criando para todo dizimista ativo — daria ao coordenador a lista de quem
   **falta** pagar, que hoje não existe; foi considerada e descartada por ora.
2. *Quando há mês em aberto diferente do mês do pagamento:* o bot **pergunta no WhatsApp**
   ("seu último registro em aberto é de outubro; este dízimo é referente a qual mês?").
   Se a competência do Previsto bate com o mês do pagamento, preenche calado.

**Consequência da decisão 1 que vale lembrar na implementação:** com Previsto nascendo só
de pagamento, **nunca há mais de um em aberto por pessoa**. A pergunta da decisão 2 não é
"qual dos vários", e sim "o aberto é de outubro e estamos em dezembro — qual dos dois?".
Isso simplifica bastante a busca.

**O que muda no código:**
- `x_studio_status` ganha o valor `Previsto`
- `registrarDevolucao` passa a procurar um Previsto aberto do dizimista antes de criar
- `x_studio_competencia` passa a ser **escrito** — hoje o bot só o lê (BL-57). Este item
  fecha o BL-57 junto
- O fluxo de comprovante ganha a pergunta de competência

**Risco:** `registrarDevolucao` é o caminho do dinheiro, onde vivem BL-02, BL-26, BL-27 e
BL-51. Vai em PR próprio, com teste por cenário antes de subir.

**Fora do desenho, de propósito:** oferta não ganha Previsto. Oferta não é compromisso
mensal, e pré-criar registro de oferta produziria linha que nunca fecha.

---

### BL-63 — O QR Code do cadastro da comunidade ✅ (P)

O formulário pedia uma imagem de QR Code por comunidade. **O bot nunca leu esse campo:**
`x_studio_qr_code` não aparece uma única vez no Apps Script.

Quem gera o QR é o `MediaService`, no momento do pagamento, montando o BR Code a partir
de `x_studio_chave_pix` (`MediaService.gs:563`). E o caminho preferido nem imagem usa — é
o card PIX nativo da Meta (`enviarCardPix`), que recebe o código como texto.

Pior que inútil, era um dado que **só podia envelhecer**: trocada a chave PIX da
comunidade, a figura continuaria mostrando a chave antiga, sem nada acusar. Quem
conferisse pela imagem conferiria errado.

**Feito:** o campo saiu do formulário. **O campo continua existindo no Odoo**, com o que já
estiver gravado nele — tirar da tela é reversível, apagar campo de imagem não é, e essa
decisão não cabe numa revisão de formulário.

**A única razão para devolvê-lo:** se a paróquia usa essa figura para **imprimir cartaz**
na porta da capela. Nesse caso são duas linhas de volta na view — mas aí vale saber que a
figura não se atualiza sozinha quando a chave muda.

---

## Itens críticos

### BL-01 — Notificações mensais quebradas 🔴 (M)
**Arquivo:** `NotificacaoHandler.gs` (linhas 148, 197, 215, 242) · `OdooService.gs`
**Problema:** chama `OdooService.executar(...)`, método que não existe (o serviço só expõe `searchRead`, `create`, `write`, `_rpc`). `executarNotificacoesDiarias()` lança `TypeError`. Além disso: filtro por `x_studio_date` (linha 220) em vez de `x_studio_data_da_devolucao`; e `processarRespostaNotificacao` (259) chama `DevolucaoHandler.iniciar` (real: `iniciarDevolucao`) e `HistoricoHandler.mostrar` (inexistente).
**Correção:** reescrever as chamadas usando `searchRead`/`create`; para `search_count`, adicionar um método `count(model, domain)` em `OdooService`. Corrigir o nome do campo de data. Remover ou corrigir `processarRespostaNotificacao`.
**Aceite:** `executarNotificacoesDiarias()` roda sem erro; um dizimista elegível recebe o template; log gravado em `x_notificacao_log`; quem já devolveu no mês não é notificado.

**⚠️ Nota de sequenciamento (auditoria 17/09/2026):** o Sprint 3 abaixo determina fazer **BL-21 e BL-24 antes** de reativar o BL-01 — mas o BL-01 está concluído e **já em produção** (trigger de hora em hora, `NotificacaoHandler.gs:356-358`), enquanto BL-21 e BL-24 seguem abertos. O envio em si é seguro: é sequencial com `Utilities.sleep(2000)` entre mensagens (`:179`), então não há rajada de *saída*. A exposição é a **onda de respostas** que chega nos minutos seguintes — o cenário 6 da análise de carga — batendo num webhook sem retry/backoff (BL-24) e sob o teto de ~30 execuções simultâneas (BL-21). **Recomendação:** priorizar BL-24 antes do próximo ciclo mensal de notificações, ou reduzir o alcance do disparo (lotes menores por hora) até que BL-21/BL-24 estejam fechados.

### BL-02 — Confirmação falsa de devolução 🔴 (P)
**Arquivo:** `ComprovanteHandler.gs:225-262`
**Problema:** se o dizimista não é encontrado, apenas loga (não avisa, não registra). Em todos os caminhos (inclusive o `catch`) envia "✅ Comprovante recebido com sucesso! Sua devolução foi registrada". No `catch`, o usuário recebe erro **e** sucesso.
**Correção:** só enviar a confirmação de sucesso quando `devolucaoId` for realmente retornado. Se dizimista nulo → mensagem orientando a se cadastrar/contatar secretaria. Em exceção → apenas a mensagem de falha (remover o sucesso duplicado). Registrar métrica/alerta para a secretaria.
**Aceite:** dizimista inexistente ou erro no Odoo ⇒ usuário recebe **somente** aviso de falha; nunca "registrada" sem registro real.

### BL-03 — Janela de sessão inconsistente 🔴 (P)
**Arquivo:** `TriggerSessoes.gs:62,70,132,135` · `StateManager.gs:163,178`
**Problema:** trigger limpa sessão com ≥15 min e avisa com ≥10; textos ao usuário prometem 60 min; comentários citam 20/50 min. Valores de teste em produção.
**Correção:** definir a janela real desejada (ex.: 60 min) numa constante única e derivar todos os limiares dela (aviso em ~50 min, limpeza em ~60). Alinhar `everyMinutes` e os textos. Corrigir comentários.
**Aceite:** um usuário que leve ~55 min no cadastro recebe o aviso e, ao clicar "continuar", mantém a sessão; nada é limpo antes do tempo prometido.

### BL-04 — Lista de comunidades > 10 rows 🔴 (P)
**Arquivo:** `CadastroHandler.gs:80-93`
**Problema:** monta rows com todas as comunidades (até 50). WhatsApp aceita no máximo 10 → chamada falha com 11+, usuário trava.
**Correção:** paginar (seções ou "ver mais") ou, no mínimo, `slice(0,10)` como o RelatorioHandler — mas paginação é o ideal para não ocultar comunidades. Considerar busca por texto se a lista crescer.
**Aceite:** com ≥11 comunidades cadastradas, o usuário consegue selecionar qualquer uma.

### BL-26 — Comprovante não validado contra o destinatário correto 🔴 (M) — **descoberto em simulação real**
**Arquivo:** `VisionService.gs:300` (`validarComprovante`) · `ComprovanteHandler.gs` · `DevolucaoHandler.gs`
**Problema:** o bot aceita qualquer comprovante que "pareça" um pagamento — nunca confere se ele foi feito para a chave PIX da comunidade. Na simulação (cadastro + devolução real), o bot instruiu pagar para **Inter / Daniel Fernandes Silva / `037.756.033-12`**, mas o comprovante enviado era para **Caixa / Marlize Ferreira Rodrigues De Sousa / `160.740.093-68`** — destinatário, banco e chave totalmente diferentes — e ainda assim foi registrado como "devolução recebida com sucesso". `validarComprovante` só soma pontos por *presença* de valor/data/tipo/palavras-chave; não há checagem de destino. Na prática, qualquer comprovante de terceiros, antigo ou de valor simbólico é aceito como dízimo (vetor de fraude/erro).
**Correção:** ao validar, comparar a chave PIX (e, se possível, nome/instituição do recebedor) extraída do comprovante com a `x_studio_chave_pix`/titular da comunidade do dizimista. Se não bater: **não** confirmar automaticamente — marcar a devolução para revisão manual (status pendente + aviso claro ao usuário de que será conferida), em vez de dizer "registrada com sucesso". Depende de BL-14 (extração confiável da chave). Considerar também validar a data (recente) e alertar divergências grosseiras.
**Aceite:** um comprovante cuja chave de destino ≠ chave da comunidade não é confirmado como sucesso; cai em revisão manual com mensagem honesta ao usuário.

**Estado atual (auditoria 17/09/2026) — ⚠️ parcial, abaixo do próprio critério de aceite.** O que existe funciona: `ComprovanteHandler._conferirChave` (linha 156) compara a chave extraída com `x_studio_chave_pix` da comunidade, normalizando e-mail e dígitos, e a mensagem ao usuário deixa de prometer confirmação quando não confere (fala em "conferência da secretaria"). **O que falta:** `OdooService.registrarDevolucao` grava `x_studio_status: 'Pendente'` para **todas** as devoluções — conferidas ou não. O único marcador de divergência é um sufixo de texto concatenado ao `x_name` (`⚠️ CONFERIR: ...`). Como tudo já nasce "Pendente", o status não carrega sinal algum e o coordenador **não tem campo filtrável** para separar os comprovantes suspeitos; depende de alguém ler o nome do registro.
**✅ Corrigido em 17/09/2026.** Ao investigar, o problema era **pior que o descrito**: o marcador não era só difícil de filtrar, era **invisível no próprio fluxo do bot**. `_listarPendentes` monta as linhas só com nome, valor e data — nunca com o `x_name` — e a tela de detalhe busca `x_name` mas não o exibe. Ou seja, o coordenador apertava "✅ Confirmar" sem nenhum sinal de que a chave não conferia; a marca só existia para quem abrisse o Odoo.

O que foi feito:
1. **Campo estruturado** `x_devolucao.x_studio_conferencia_pix` (char), com os valores `ok` | `divergente` | `ausente` | `sem_referencia`, gravado por `registrarDevolucao`. Criado pela função idempotente **`criarCampoConferenciaPix()`** em `SetupCamposFamilia.gs`, seguindo o padrão `ir.model.fields` já usado pela funcionalidade de família. **É preciso rodá-la uma vez no editor do Apps Script.**
2. **Degradação segura:** `OdooService._temCampoConferenciaPix()` checa o schema uma vez (cache de 6 h; 5 min enquanto ausente) e só grava/consulta o campo se ele existir. Sem isso, um deploy feito antes do setup faria **toda** devolução falhar — uma devolução perdida é pior que um aviso ausente.
3. **Visibilidade para o coordenador:** a lista de pendentes prefixa `⚠️` no nome e `CONFERIR •` na descrição; a tela de detalhe mostra o motivo por extenso (`⚠️ Confira antes de confirmar: ...`) logo acima dos botões de baixa.
4. **Correção de precisão:** `sem_referencia` (comunidade sem chave PIX cadastrada) antes era rotulado como "chave não identificada no comprovante", culpando o arquivo do dizimista por uma falha de cadastro da comunidade. Agora tem texto próprio.
5. O sufixo no `x_name` foi mantido como redundância visível no backend.

**Observação:** devoluções criadas antes desta mudança ficam sem valor no campo e não exibem alerta — não há como saber retroativamente se a chave conferia, e marcá-las como `ok` seria mentira.

### BL-27 — Fallback de PDF aceita qualquer arquivo 🔴 (P) — **descoberto na auditoria de 17/09/2026**
**Arquivo:** `ComprovanteHandler.gs:99-119`
**Problema:** quando a Vision API não consegue extrair texto de um PDF (protegido, escaneado ruim, corrompido — ou simplesmente um PDF que não é comprovante), o código **força** o resultado como válido: `ehComprovante: true`, `valor: 0`, `chavePix: null`, `confianca: 50`, e segue para o registro no Odoo. Consequência: **qualquer PDF cria uma devolução de R$ 0,00** no Odoo. Como `chavePix` é `null`, a conferência do BL-26 devolve `ausente` e o registro é apenas marcado para conferência — ou seja, não é fraude silenciosa, mas é **exatamente o vetor que o BL-26 existe para fechar, alcançável trocando a imagem por um PDF**. Também polui a lista de pendentes com registros de valor zero.
**Correção:** não tratar "OCR falhou" como "comprovante válido". Opções, em ordem de preferência: (a) pedir ao usuário que reenvie como **foto** ou um PDF legível, sem registrar nada; (b) se a paróquia quiser preservar o envio, registrar em um estado explicitamente distinto (ver campo estruturado do BL-26) com valor nulo e aviso honesto de que **nada foi confirmado**. Em nenhum caso enviar "✅ Comprovante recebido" para um arquivo do qual não se extraiu dado algum.
**Aceite:** um PDF sem texto extraível não gera devolução de R$ 0,00 silenciosamente; o usuário recebe orientação clara para reenviar, ou o registro fica em estado distinguível de uma devolução normal.

**✅ Corrigido em 17/09/2026 — opção (a).** O bloco de fallback saiu de `_processarArquivo`; quando `VisionService.analisarPDF` não devolve dados, o resultado é marcado com `pdfIlegivel` e **nada é registrado**. `_tratarResultado` responde com orientação para reenviar como foto ou PDF original do banco, **mantendo o estado `AGUARDANDO_COMPROVANTE`** para o reenvio não exigir refazer o fluxo. Removido também o ramo `isPdfFallback`, que ficou inalcançável (`dados.tipo` nunca mais vale `'PDF'`, pois `_extrairTipoTransacao` só retorna PIX/TED/DOC/Boleto/Desconhecido).
**Limitação conhecida (→ BL-24):** `analisarPDF` retorna `null` tanto para "PDF sem texto" quanto para falha transitória da Vision API (429/5xx/exceção), então uma indisponibilidade cai na mesma mensagem. É seguro — nada é registrado em nenhum dos casos, contra o registro falso de R$ 0,00 de antes — mas a orientação "envie uma foto" não ajuda durante uma queda da API, já que o caminho de imagem usa o mesmo serviço. Distinguir os dois casos exige mudar o contrato de retorno do `VisionService` e pertence ao BL-24 (retry/backoff), não a este item.

---

## Itens médios

### BL-05 — Comunidade não gravada na devolução 🟠 (P) — **verificar no Odoo**
**Arquivo:** `OdooService.gs:333` (`registrarDevolucao`) vs `:406` (`buscarDevolucoesPendentes`)
**Problema:** `registrarDevolucao` não grava `x_studio_comunidade`, mas a busca de pendentes filtra por esse campo. Se ele não for *related/stored* (derivado do dizimista) no Odoo Studio, o coordenador verá sempre "nenhuma pendente" e as baixas nunca ocorrem.
**Ação:** confirmar no Odoo se `x_devolucao.x_studio_comunidade` é computado a partir do dizimista. Se **não** for: gravar a comunidade no `registrarDevolucao` (buscar do dizimista) **ou** tornar o campo related/stored.
**Aceite:** uma devolução criada pelo bot aparece na lista de pendentes da comunidade correta.

### BL-06 — Parse de valor com milhar 🟠 (P)
**Arquivo:** `CadastroHandler.gs:190`
**Problema:** `"1.000,50"` → `parseFloat("1.000.50")` → `1`. `VisionService._extrairValor` já trata milhar corretamente — inconsistência.
**Correção:** remover separador de milhar antes do decimal: `.replace(/\./g,'').replace(',', '.')` (ou reusar a lógica do VisionService). Validar limites razoáveis.
**Aceite:** `1.000,50` vira `1000.5`; `50` e `50,00` seguem corretos.

### BL-07 — Estado setado sem dados de pagamento 🟠 (P)
**Arquivo:** `DevolucaoHandler.gs:65-75`
**Problema:** `_enviarDadosPagamento` retorna cedo quando não há PIX, mas `setEstado(AGUARDANDO_COMPROVANTE)` roda sempre depois.
**Correção:** `_enviarDadosPagamento` retornar boolean; só setar o estado se enviou os dados com sucesso.
**Aceite:** comunidade sem PIX ⇒ usuário recebe erro e **não** fica em `AGUARDANDO_COMPROVANTE`.

### BL-08 — Data de nascimento inválida aceita 🟠 (P)
**Arquivo:** `CadastroHandler.gs:142-160`
**Problema:** valida só faixa de dia/mês; aceita `31/02/2050`.
**Correção:** validar data real (construir `Date` e conferir dia/mês/ano de volta) e rejeitar datas futuras e anos implausíveis.
**Aceite:** `31/02/2050` e datas futuras são recusadas com mensagem clara.

### BL-09 — Webhook processa só a 1ª mensagem 🟠 (M)
**Arquivo:** `Webhook.gs:69`
**Problema:** lê `messages?.[0]`; a Meta pode agrupar várias entradas/mensagens num POST — as demais somem sem log.
**Correção:** iterar `entry[] → changes[] → messages[]`, aplicando idempotência por `messageId` a cada uma.
**Aceite:** um POST com 2 mensagens resulta em 2 processamentos.

### BL-10 — Atalhos globais abortam cadastro 🟠 (P)
**Arquivo:** `Router.gs:185-199` · `Config.gs:100-108`
**Problema:** durante o cadastro, `menu`/`0`/`rel` descartam os dados sem confirmação (ex.: apelido "Rel").
**Correção:** não aplicar os atalhos durante `ESTADOS_CADASTRO` (como já se faz para os estados de relatório), ou pedir confirmação antes de descartar.
**Aceite:** digitar "Rel" no campo de apelido salva o apelido, não abre o relatório.

### BL-11 — Payload PIX (BR Code) 🟠 (M)
**Arquivo:** `MediaService.gs:259-317`
**Problema:** tag `54` com length `00` quando valor vazio (EMV inválido); nome/cidade fixos no código; QR gerado via `api.qrserver.com` (terceiro sem SLA + envio da chave PIX e valor para fora).
**Correção:** omitir a tag 54 quando não houver valor; puxar nome/cidade de parâmetros do Odoo; avaliar gerar o QR localmente (evita dependência externa e vazamento).
**Aceite:** BR Code válido com e sem valor; sem chamada a serviço externo com dado sensível.

---

### BL-28 — Resposta interativa fora de contexto aborta o cadastro 🟠 (P) — **descoberto no teste de carga de 17/09/2026** — ✅ concluído em 18/09
**Arquivo:** `Router.gs` — fallback final de `_rotearInterativo`, ramo `list_reply`
**Problema:** o tratamento de `list_reply` testa o estado atual contra uma sequência de casos conhecidos e, não casando com nenhum, cai em `MenuHandler.menuPrincipal(from)`. Isso **põe o usuário de volta no menu e abandona o cadastro em andamento**, sem aviso e sem explicação.

Observado ao vivo no teste de carga: uma seleção de comunidade chegou enquanto o estado era `AGUARDANDO_CONFIRMACAO_NUMERO` e o log registrou
```
📋 Lista selecionada: com_30
📊 Estado: AGUARDANDO_CONFIRMACAO_NUMERO
📝 Estado → MENU
```

**Por que acontece de verdade, e não só em teste:** o WhatsApp mantém as mensagens interativas antigas clicáveis na conversa. Basta o usuário rolar para cima e tocar numa lista de uma etapa anterior — ou numa lista de outro fluxo — para perder o cadastro que estava preenchendo. Não é preciso concorrência nem má-fé.

**Relação com o BL-10:** aquele item tratou exatamente este risco para os atalhos de *texto* (`menu`, `0`, `rel`), que passaram a não abortar o cadastro. As respostas *interativas* fora de contexto ficaram de fora — até agora.

**✅ Corrigido em 18/09.** `Router._interativoForaDeContexto` resolve os dois casos (lista e botão desconhecido) com a mesma regra: **havendo cadastro em andamento, o cadastro vence**. O toque é descartado, a pessoa é avisada de que aquela opção era de uma etapa anterior, e `CadastroHandler.reapresentarPasso` repete a pergunta do passo atual — os 10 estados do cadastro estão cobertos. Sem cadastro em andamento, continua indo ao menu.

**Aceite:** tocar numa lista antiga durante o cadastro não apaga o progresso — atendido.

**Correção sugerida:** durante os `ESTADOS_CADASTRO`, não deixar uma seleção desconhecida cair no menu. Mínimo: responder algo como "não entendi essa opção — vamos continuar de onde paramos" e reenviar a pergunta do passo atual, preservando estado e dados. O mesmo vale para `button_reply`, que deve ser verificado junto.
**Aceite:** tocar numa lista antiga da conversa durante o cadastro não faz o usuário perder o que já preencheu.

### BL-29 — Mensagens fora de ordem gravam no campo errado 🟠 (G) — **comprovado no teste de carga de 17/09/2026** — ⚠️ parcial em 18/09
**Arquivos:** `Webhook.gs` · `Router.gs` · `StateManager.gs` — é do modelo de execução, não de um ponto específico
**Problema:** o WhatsApp entrega cada mensagem como um POST separado, o Apps Script executa os POSTs **em paralelo**, e o fluxo de cadastro decide o que fazer lendo o estado atual. Quando duas mensagens do mesmo usuário se sobrepõem, **quem lê o estado primeiro ganha** — e a ordem em que o usuário digitou deixa de valer.

Evidência direta do log, com as respostas enviadas em ordem e 400 ms de intervalo:
```
20:27:57.102  📊 Estado: AGUARDANDO_NOME
20:27:57.361  📝 Estado → AGUARDANDO_NOME_USUAL      ← outra mensagem já gravou o "nome"
20:27:57.633  📱 Mensagem (..._0_...)                 ← a PRIMEIRA mensagem chega só agora
20:27:57.683  💬 "Joao da Silva Teste" | Estado: AGUARDANDO_NOME_USUAL
```
"Joao Teste" foi gravado como **nome completo** e "Joao da Silva Teste" como **apelido** — invertidos. Mais adiante, "50" (valor mensal) chegou em `AGUARDANDO_DATA_NASCIMENTO` e foi recusado como data inválida; o cadastro parou em `AGUARDANDO_VALOR_MENSAL` esperando um valor que já tinha sido consumido no passo errado.

**Por que é mais grave que o lost update do BL-20.** Não houve **nenhum** `Lock não obtido` nesse teste: a proteção do BL-20 funcionou e nada foi sobrescrito. O dado não se perde — vai para o **campo errado**. Perda é visível (campo vazio); isto não é. O cadastro termina completo, plausível e incorreto.

**Lock não resolve.** Serializar o processamento por usuário faria uma execução esperar a outra, mas **não impõe ordem**: continuaria valendo quem pegasse o lock primeiro. Preservar a ordem exigiria bufferizar as mensagens e ordená-las por `timestamp` antes de processar — o que recai no processamento assíncrono descartado no BL-21.

**⚠️ Acoplamento com o BL-21 — a janela é proporcional à duração da execução.** Com execuções de ~2 s, só se atropelam mensagens enviadas com menos de 2 s de diferença. Nas medições reais deste teste as execuções levaram **10 a 24 s**, então mensagens separadas por *dezenas de segundos* ainda se sobrepõem. Reduzir o tempo de execução não é só questão de vazão: **estreita diretamente a janela deste bug**.

**Caminhos possíveis, do mais barato ao mais estrutural:**
1. **Detectar e avisar.** Guardar o `timestamp` da última mensagem processada por usuário; se chegar uma mais antiga, responder algo como "recebi suas mensagens fora de ordem, vamos confirmar" e reapresentar o passo. Não evita o atropelo, mas troca corrupção silenciosa por erro visível.
2. **Confirmar o resumo antes de gravar.** O cadastro já mostra um resumo no fim; torná-lo um passo de confirmação obrigatório dá ao usuário a chance de pegar campos trocados.
3. **Ordenar por `timestamp` antes de processar** — exige fila, ou seja, o BL-21.

**⚠️ Tratado em 18/09, em dois níveis — e só o primeiro é conserto.**

**1. Dentro de um POST: ordenado por `timestamp` (conserto).** Quando a Meta agrupa várias mensagens num lote, a ordem do array não é garantida — a documentação dela manda usar o campo `timestamp`. Aí a ordem correta é conhecida e está toda em mãos, então ordenar **elimina** o atropelo nesse caso. O `sort` do V8 é estável, então mensagens do mesmo segundo mantêm a ordem em que vieram.

**2. Entre POSTs separados: portão monotônico (mitigação).** `_mensagemForaDeOrdem` guarda o maior `timestamp` já processado por usuário; uma mensagem estritamente mais antiga é **recusada** em vez de gravada no campo de quem estiver na vez, e `reapresentarPasso` (do BL-28) repete a pergunta. A pessoa é avisada.

**O que continua aberto, e por quê.** O `timestamp` do WhatsApp tem granularidade de **um segundo**. Duas mensagens digitadas com 400 ms de diferença podem trazer o mesmo valor, e o portão não tem como distingui-las — nesse caso a mensagem passa e o atropelo segue possível. Impor ordem de verdade exigiria bufferizar e ordenar antes de processar: a fila assíncrona que o **BL-21 avaliou e descartou** por não caber nos limites do Apps Script.

Isto vale porque a janela real é grande: as execuções medidas levaram **10 a 24 s**, então mensagens separadas por vários segundos ainda se atropelam — e essas o portão pega. O resto é atacado por outros dois caminhos: reduzir o tempo de execução (BL-21) estreita a janela, e o cadastro por formulário (BL-33) a elimina naquele caminho, porque uma submissão só não tem com quem competir.

**Escopo estreito de propósito:** o portão só age durante o cadastro. Fora dele, chegar fora de ordem é inofensivo — um toque no menu ou a escolha de uma devolução não gravam resposta em campo de outra pergunta. Recusar mensagem onde não há dano seria trocar uma falha silenciosa por uma barulhenta.

**Aceite:** duas respostas enviadas em sequência rápida não acabam gravadas em campos trocados sem que o usuário perceba — **atendido para diferenças de 1 s ou mais**; abaixo disso, o cadastro por formulário é a resposta.

---

### BL-30 — Cadastro por WhatsApp Flow 🟠 (M) — ✅ concluído em 18/09 (entrada ligada pelo BL-33)
**Arquivos:** `FlowHandler.gs` (novo) · `Router.gs` · `Config.gs` · `ferramentas/flow-cadastro.json` · `ferramentas/simula-flow.js`
**Documentação:** `Documentação/FLOW-CADASTRO.md`

**Ideia:** trocar as ~15 mensagens e ~9 execuções do cadastro conversacional por **um formulário nativo**: 2 mensagens, **1 execução**. Como há uma gravação só, a corrida do **BL-29 deixa de existir nesse caminho** — não é mitigada, é eliminada, porque não há duas execuções do mesmo usuário competindo.

**Feito:**
- `FlowHandler.processar` trata o `nfm_reply`, revalida **tudo** (as validações do Flow JSON rodam no cliente, então o que chega é dado não verificado) e reaproveita `mostrarResumo` → `finalizar`. O Flow troca a **coleta**, não a gravação.
- Ramo `nfm_reply` no `Router`. Sem ele a resposta cairia no `menuPrincipal` do fim de `_rotearInterativo` e o formulário inteiro sumiria em silêncio — o mesmo buraco do BL-28.
- `ferramentas/simula-flow.js` manda ao webhook o `nfm_reply` que o aparelho mandaria, com 5 casos (`ok`, `data-invalida`, `valor-zero`, `campo-faltando`, `token-errado`). **Não exige criar Flow na Meta**: no modo sem endpoint, um cadastro por Flow é exatamente uma requisição HTTP.
- 12 casos de `_normalizar` exercitados fora do GAS, sob `America/Sao_Paulo`. Achado que virou código: o `DatePicker` devolve **epoch em ms na meia-noite UTC**, e lê-lo com `getDate()` num projeto UTC-3 voltaria **um dia em todo cadastro** — daí o `getUTCDate()`.

**Teste no aparelho (18/09):** `enviarFlowDeTeste()` no `Setup.gs` manda o Flow em **rascunho** (`mode: 'draft'`) para um número real — a Meta não exige publicar o Flow para isso. Duas restrições que passam por bug: rascunho só abre para números com papel na conta da Meta (admin/dev/testador), e a janela de 24 h continua valendo.

**Não feito (proposital):**
- **A entrada não está ligada.** `CadastroHandler.iniciar` continua indo pelo fluxo conversacional. Ligar exige o Flow publicado na Meta e testado num aparelho — o simulador cobre o servidor inteiro, não a renderização.
- `FLOW_ID_CADASTRO` ausente faz `enviarFlowCadastro` devolver `false`, então este código pode ser publicado **antes** de existir Flow algum.
- **Foto de perfil fora do formulário**: exigiria tratar upload de mídia, e o ganho do Flow está em cortar mensagens de texto.

**Modo com endpoint é inviável aqui**, e não por escolha: a Meta exige RSA-OAEP-SHA256 + AES-128-GCM por tela, e o Apps Script só tem `computeRsaSha256Signature`, que **assina** — não decifra.

**O Flow não resolve a devolução**, que é o fluxo caro (500/mês contra um cadastro único por pessoa): ela depende de comprovante em imagem/PDF e de OCR.

**Aceite:** com o Flow publicado, um cadastro completo entra em 1 execução e o resumo sai correto; um formulário com data inexistente é recusado pelo servidor.

---

### BL-31 — Webhook descartava os callbacks de entrega 🟠 (P) — **descoberto testando o Flow em 18/09/2026** — ✅ corrigido
**Arquivo:** `Webhook.gs`
**Problema:** o laço de `entry[] → changes[]` fazia `continue` em todo POST sem `value.messages`, o que joga fora **todos os callbacks de status**. O sintoma só apareceu quando uma mensagem aceita pela Meta não chegou ao aparelho: o log mostrava `📤 … ok` seguido de `ℹ️ POST sem mensagens de usuário`, e não havia mais nada a olhar.

**Por que isso deixa cego.** O 200 do envio significa apenas que a Meta **aceitou a mensagem na fila** — não que entregou. Falha de entrega (aparelho com WhatsApp antigo demais para o recurso, número inválido, janela fechada, recurso não suportado no aparelho) só é comunicada por esse callback, com um código e um `details`. Descartá-lo transforma qualquer não-entrega em "não chegou", sem diagnóstico.

**Correção:** `_registrarStatusEntrega` registra os `statuses`. `failed` vira `console.error` com código e `details`; `sent`/`delivered`/`read` ficam em log comum — separados porque são três callbacks por mensagem entregue e, como erro, virariam ruído.

**Aceite:** uma mensagem que não chega deixa no log o código de erro da Meta.

---

### BL-32 — Nono dígito: mensagem aceita e nunca entregue 🟠 (P) — **descoberto testando o Flow em 18/09/2026** — ✅ concluído
**Arquivos:** `Utils.gs` · `Webhook.gs` · `AuditoriaNumeros.gs` (novo)

**O que aconteceu.** O envio para `5586988521231` voltou **HTTP 200** e a mensagem nunca chegou. O WhatsApp daquele aparelho é `558688521231` — **sem o 9** depois do DDD. Trocado o número, o formulário chegou na hora.

**Por que a falha é traiçoeira.** A Meta aceita os dois formatos e devolve 200 nos dois. Não há erro, não há exceção, e o contador conta como enviada: todos os sinais de sucesso, nenhuma entrega.

**A regra, e o limite dela.** Nos DDDs **11–19, 21, 22, 24, 27 e 28** o `wa_id` mantém o 9 — são as regiões que receberam o nono dígito antes de o WhatsApp chegar. Nos demais, contas antigas ficaram registradas com os 8 dígitos de então. Mas **é heurística**: uma conta criada depois da mudança mantém o 9 em qualquer DDD. E não há como conferir: a Cloud API **não tem endpoint de validação** (o `contacts` do On-Premises foi descontinuado e respondia "válido" para qualquer entrada).

**⚠️ CORREÇÃO DE 18/09, DEPOIS DE VERIFICAR NO CÓDIGO.** A primeira versão deste item dizia que o lembrete mensal para 500 pessoas corria risco. **Não corre.** O número gravado no Odoo vem de `x_studio_partner_phone` ← `dados.whatsapp` ← `from` do webhook — que é o `wa_id` **por construção**, não por convenção. Todo dizimista cadastrado pelo bot já está no formato que entrega.

**Onde o risco realmente estava:** em número **digitado fora do fluxo do bot**. Foi exatamente o caso — a propriedade `NUMERO_TESTE`, preenchida à mão. O mesmo vale para contato criado direto no Odoo pela secretaria, que é a única porta que ainda não passa pelo webhook.

**Feito:**
- `Utils.variantesNumeroBR` devolve as duas formas e o palpite por DDD.
- Na falha de entrega (BL-31), o log sugere a outra forma. É o **único sinal confiável**: a resposta do envio devolve 200 e o número como veio.
- `auditarNumerosWhatsApp()` lê o Odoo e separa o que destoa do formato usual do DDD. Com a origem sendo o webhook, espera-se relatório limpo — e é justamente por isso que ele serve: **um suspeito na lista denuncia um contato que não veio do bot**.
- `Utils._conferirDestinatario` avisa quando a Meta normaliza o número. **Sinal secundário:** quando ela normaliza, a mensagem chega; no caso deste item nada foi avisado ali.

**Descartado:** um campo próprio para o `wa_id` no `x_dizimista`, cogitado antes da verificação acima. Seria duplicar um dado que `x_studio_partner_phone` já guarda corretamente.

**Aceite:** uma não-entrega por formato de número deixa no log o número alternativo a tentar — atendido.

---

### BL-33 — Ligar o Flow no fluxo de cadastro 🟠 (G) — ✅ **concluído em 18/09/2026**

Refatorar o cadastro para usar o formulário do WhatsApp. O Flow já funciona
ponta a ponta (BL-30) e já foi testado num aparelho real; o que falta é ligá-lo
na entrada.

**O pedido, em quatro partes:**

1. **Usar o formulário no fluxo de cadastro.** Hoje `CadastroHandler.iniciar`
   vai direto para a conversa; `FlowHandler.enviarFlowCadastro` existe mas nada
   o chama fora do `enviarFlowDeTeste`.

2. **Não remover o cadastro conversacional.** Os dois convivem. Isso não é só
   prudência de migração: quem abre o Flow e desiste, quem está num aparelho
   que não renderiza o formulário e quem cai no erro de validação do servidor
   precisam de um caminho — e o caminho é o de hoje.

3. **Uma propriedade que liga e desliga.** Um interruptor no Script Properties
   (`FLOW_CADASTRO_ATIVO`, por exemplo). Reparar que `FLOW_ID_CADASTRO` ausente
   já faz `enviarFlowCadastro` devolver `false` — mas isso é *não configurado*,
   não *desligado*. São coisas diferentes: com o Flow publicado e funcionando,
   é preciso poder voltar atrás sem apagar o id.

4. **Pedir a foto depois do cadastro pelo Flow.** Hoje a foto está fora do
   formulário de propósito (exigiria tratar upload de mídia no Flow), e quem
   vem pelo Flow cai direto no resumo, sem foto. O pedido é acrescentar o passo
   de foto **depois** da submissão.

**A investigar antes de implementar: o cadastro de MEMBRO da família.** O
pedido cita isso explicitamente, e com razão — o fluxo de membro não é o de
cadastro com outro rótulo. Ele diverge em pelo menos quatro pontos, todos com
`if (cadastrandoMembro)` espalhados pelo `CadastroHandler`:

| Onde | O que muda |
|---|---|
| `iniciarCadastroMembro` (:80) | grava `cadastrandoMembro` e `responsavelId` na sessão |
| `processarDataNascimento` (:239) | oferece o endereço do responsável em vez de pedir |
| `processarValorMensal` (:311) | pula notificações e pergunta o dia da devolução |
| `processarDiaPreferido` (:380) | vai para `_pedirFotoMembro`, sem texto de lembrete |
| `finalizar` (:522) | chama `criarMembro(dados, responsavelId)`, não `criarDizimista` |

Um Flow de membro precisaria de menos campos (sem comunidade, sem
notificações) e de dados do responsável embarcados no
`flow_action_payload.data`. **Decidir se vale um segundo Flow, uma tela
condicional no mesmo Flow, ou deixar o cadastro de membro na conversa** — a
terceira é legítima, porque membro é evento ainda mais raro que cadastro.

**Pontos de partida:** `FlowHandler.enviarFlowCadastro` · `CadastroHandler.iniciar`
(:34) e `iniciarCadastroMembro` (:80) · o passo de foto em `solicitarFoto` (:434),
`processarFotoPerfil` (:441) e `ESTADOS.AGUARDANDO_FOTO_PERFIL` ·
`ferramentas/flow-cadastro.json` · `Documentação/FLOW-CADASTRO.md` seção 5.

**✅ Feito em 18/09:**
- `CadastroHandler.iniciar` tenta o Flow e cai na conversa quando `enviarFlowCadastro` devolve `false` — o que acontece se o interruptor estiver desligado, se o id faltar, se o Odoo não responder ou se não houver comunidade ativa.
- Interruptor `FLOW_CADASTRO_ATIVO`, com `ativarFlowCadastro()` / `desativarFlowCadastro()` no `Setup.gs`. Separado do id de propósito: numa hora ruim se quer voltar em segundos sem perder a configuração.
- A foto vem depois da submissão, com opção de **pular** — ao contrário do cadastro por conversa. Ali a foto é uma pergunta entre outras; aqui é a única coisa entre a pessoa e um cadastro que ela já preencheu inteiro, e travar nesse ponto seria perdê-lo pelo passo mais dispensável.
- Quem recebe o formulário e **escreve** em vez de preencher cai na conversa, em `confirmarNumero`. É o caso de quem desistiu, de quem está num aparelho que não renderiza e de quem não viu o botão — todos continuam querendo se cadastrar.

**Sobre o MEMBRO da família — decisão revista no mesmo dia, e a premissa estava errada.** Eu havia deixado membro na conversa argumentando que "é evento mais raro que cadastro". **Não conferi, e é provavelmente o contrário:** uma família de quatro pessoas gera 1 cadastro e 3 membros, então em agregado membros podem ser MAIS frequentes.

E o critério que pesa não era o que eu estava usando. Não é custo de mensagem: é **usabilidade** — quem acabou de preencher um formulário e toca em "Adicionar membro" cair numa conversa de oito perguntas é uma inconsistência gritante, justamente para quem mais usa o bot.

**Feito:** `ferramentas/flow-membro.json` (6 campos, sem comunidade nem notificação) + `FlowHandler.enviarFlowMembro` + `_processarMembro`, com `FLOW_ID_MEMBRO` próprio e o mesmo interruptor. **Endereço e dia chegam preenchidos** com os do responsável — na conversa isso custa uma pergunta com dois botões e um estado; no formulário é um campo que já vem certo.

**Aceite:** com a propriedade ligada, um cadastro completo entra em 1 execução
de coleta e termina com foto; com ela desligada, nada muda em relação a hoje.

---

### BL-34 — Texto durante o formulário derruba para a conversa cedo demais 🟡 (P) — ✅ **resolvido pelo BL-44 em 19/09/2026**
**Arquivo:** `Router.gs` — ramo `AGUARDANDO_FLOW_CADASTRO` em `_rotearTexto`

**Como era:** **qualquer** texto enviado com o formulário aberto levava a pessoa para o cadastro por conversa — 19 mensagens. Atendia bem "não consegui abrir" e atropelava "quanto é o dízimo?": o gatilho não distinguia intenção.

**As duas saídas registradas eram** perguntar com dois botões, ou manter. **Venceu uma terceira**, que só apareceu quando o cadastro por conversa foi desligado (BL-44): não perguntar nem decidir — **lembrar**. A pessoa fica onde estava, o formulário continua aberto e clicável na conversa, e o lembrete traz as duas portas que não exigem cadastro (Oferta e Contato Pastoral).

Quem travou no formulário tem para onde ir; quem só fez uma pergunta não é arrastado para lugar nenhum. E o "sem dado para decidir" deixou de ser bloqueio, porque a resposta não depende mais de saber qual caso é mais comum.

**O achado relacionado virou vantagem.** A mensagem do formulário continuar clicável depois era anotado como defeito — é ela que o lembrete manda tocar.

---

### BL-35 — Freio de gasto: uma pessoa podia gerar cobrança sem limite 🟠 (P) — ✅ concluído em 18/09/2026
**Arquivos:** `Utils.gs` (`excedeuTaxa`) · `Webhook.gs`

**O problema.** Mensagem RECEBIDA é grátis; o que custa é a RESPOSTA do bot. Então bastava alguém mandar mensagem sem parar para cada resposta nossa entrar na conta — e a franquia de 1.000 mensagens de serviço por mês (a partir de 01/10/2026) some rápido assim. Não precisa de má-fé: uma criança com o celular do pai, um número em laço com outro bot, alguém testando.

**Correção.** Duas janelas por número — 12 por minuto e 60 por hora, ajustáveis por `LIMITE_MSG_MINUTO` e `LIMITE_MSG_HORA` sem republicar. Ao estourar, o bot **para de responder**: continuar respondendo "você excedeu" gastaria exatamente o que se quer economizar. Um aviso por hora, no máximo, porque o aviso também é cobrado.

**Os limites vieram do uso medido**, não de palpite: cadastro por conversa são ~13 mensagens, devolução ~5, e o dia mais pesado plausível (cadastro + dois familiares + devolução) fica perto de 45. Os limites ficam acima disso de propósito — barrar quem está usando é pior que deixar passar algum abuso, porque o abuso aparece no log e o usuário barrado some sem avisar.

**Uma armadilha que o teste pegou, e o código tinha.** `cache.put` renova o TTL a cada escrita, então um contador de chave fixa nunca expira enquanto chegarem mensagens: a janela de 60 s viraria "60 s desde a última mensagem", e quem respondesse a cada 20 s seria barrado no meio do próprio cadastro. A chave passou a incluir o **balde de tempo** — a janela fecha porque a chave muda.

**Aceite:** um cadastro completo e um dia pesado passam inteiros; 200 mensagens seguidas são cortadas — conferido nos dois padrões, rápido e lento.

---

### BL-36 — Lista de bloqueio de telefones e detecção automática de spam 🟠 (M) — ✅ **parte 1 concluída em 19/09/2026**
**Arquivos previstos:** `Utils.gs` (junto de `excedeuTaxa`) · `Webhook.gs` · `Setup.gs` (administração)

Segundo nível sobre o freio do **BL-35**. O freio corta o **laço** — 12 por minuto, 60 por hora — mas zera a cada janela: quem insiste volta a consumir resposta indefinidamente, em ondas. Falta poder dizer "este número não fala mais com o bot".

**Duas partes, e a segunda é a delicada.**

**1. A lista em si.** Bloqueio por número, consultado no `_processarMessagemWebhook` antes de qualquer resposta. Precisa de:
- Onde guardar. `ScriptProperties` é enumerável e permanente, mas o store é compartilhado com a configuração e tem ~500 KB — uma lista grande o disputaria com os segredos e os contadores. O Odoo é o lugar natural para dado que cresce, custa ~225 ms e precisaria de cache.
- Administração: incluir, remover e listar. Como é ação irreversível do ponto de vista de quem está do outro lado, vale o mesmo cuidado de `limparTodasSessoes()` — uma função que só lê ao lado da que age.
- Decidir se o bloqueado recebe alguma mensagem. **Provavelmente não:** avisar custa exatamente o que o bloqueio existe para evitar, e informa ao abusador que ele foi detectado.

**2. Identificar spam sozinho.** É onde o item pode causar mais dano que o problema. Um falso positivo **bloqueia um dizimista** — e ele não recebe aviso, some em silêncio, e ninguém fica sabendo até a pessoa reclamar pessoalmente na paróquia. O sintoma não aponta para a causa.

Sinais possíveis, do mais para o menos confiável:
- **Estourar o freio do BL-35 repetidas vezes em dias diferentes.** O mais defensável: já é comportamento anômalo medido, não inferido.
- **Volume sem nunca completar fluxo nenhum** — muitas mensagens, zero cadastro e zero devolução.
- **Conteúdo** (links, texto repetido, mensagem idêntica em sequência). O mais frágil: um dizimista confuso repete mensagem, e link pode ser legítimo.

**Recomendação para quando for feito:** começar com **sugestão, não bloqueio automático**. O sistema marca o número como suspeito e registra; a inclusão na lista é humana. Só depois de ver os candidatos reais por um tempo é que dá para saber se algum critério é seguro o bastante para agir sozinho — e esse dado não existe hoje.

**Aceite:** um número na lista não gera resposta nenhuma; nenhum dizimista ativo entra na lista sem decisão humana.

#### ✅ Implementado em 19/09

**Onde guardar — decidido:** uma propriedade por número (`bloqueado_<numero>`), não uma lista JSON numa chave só. Mesmo raciocínio do BL-22: com chave por usuário, cada execução escreve só a sua, some o read-modify-write compartilhado e o lock fica desnecessário. Numa paróquia a lista tem punhados de números, longe dos 500 KB do store. O Odoo ficou de fora: ~225 ms por mensagem recebida não se paga para um dado que quase não cresce.

**O portão** (`Utils.estaBloqueado`) roda no `_processarMensagemWebhook` **antes do freio de taxa** — de propósito: o freio ainda responde uma vez por hora com o aviso de pausa, e para quem está bloqueado nem isso deve sair. O resultado vai para o cache, com TTL curto quando não está bloqueado, para um bloqueio novo valer em minutos.

**Administração** (`Setup.gs`): `bloquearNumero(numero, motivo)`, `desbloquearNumero`, `listarBloqueados`, `listarSuspeitos`, `limparSuspeitos`. O `bloquearNumero` **avisa se o número for de um dizimista cadastrado** — não impede, porque há casos legítimos, mas quem bloqueia precisa saber que aquela pessoa vai parar de receber lembretes e não conseguirá devolver, sem nenhum aviso.

**Parte 2 — detecção automática: marcada, não automatizada.** Seguindo a recomendação deste próprio item. `Utils.marcarSuspeito` registra quantos **dias distintos** o número estourou o freio; a partir de 3, o log avisa que há candidato. **Nada é bloqueado sozinho.** A razão continua valendo: um falso positivo cala um dizimista em silêncio, o sintoma não aponta para a causa, e não existe dado real sobre qual critério seria seguro. O `listarSuspeitos()` existe justamente para produzir esse dado.

⏭️ **PULADO (execução automática):** o bloqueio automático. Precisa de meses de `listarSuspeitos()` com tráfego real antes de qualquer critério agir sozinho — é decisão que depende de dado que ainda não existe, não de código.

---

### BL-37 — Enxugar a devolução, o único fluxo recorrente 🟠 (M) — ✅ concluído em 18/09/2026
**Arquivos:** `DevolucaoHandler.gs` · `MediaService.gs` (`enviarQrCode`) · `ComprovanteHandler.gs` · `Utils.gs` (`sinalizarProcessando`) · `Router.gs` · `Webhook.gs` · `CadastroHandler.gs`
**Base:** `Documentação/FLUXOS.md` §4 · verificado por `node ferramentas/conta-mensagens.js`

**Primeiro, uma correção.** Este item foi escrito dizendo que a devolução custava **8 mensagens**, número obtido lendo o código. O harness executou o fluxo e contou **6**: duas das mensagens que eu listei — uma abertura "Vou te passar os dados" e uma confirmação "Confirma?" — **não existem** no caminho individual. A conta mensal, portanto, estava superestimada em 40% (R$ 87,50, não R$ 122,50).

**O plano original era cortar 4 mensagens, uma delas o QR Code. O resultado foi melhor: 6 → 3, com o QR Code mantido.**

| Era | Virou | O que se perdeu |
|---|---|---|
| Dados da comunidade numa mensagem; QR noutra, com legenda genérica | **Os dados VÃO na legenda do QR** | Nada. A legenda dizia "escaneie pelo app do banco" — o óbvio — enquanto uma mensagem cobrada carregava os dados |
| "⏳ Analisando comprovante..." | **Indicador de digitação** da Cloud API | Nada; melhora. Balão vivo em vez de linha parada, e não é mensagem |
| Dados do OCR numa mensagem, resultado noutra | **Uma mensagem só** | Nada. O resultado já repetia valor e data |

**O que NÃO foi fundido, e por quê:**

- **O copia-e-cola.** É a única mensagem que existe para ser copiada inteira: um toque longo → Copiar precisa levar exatamente o payload EMV. Texto em volta, ou um negrito envolvendo o código, entraria na cópia e o app do banco recusaria. Fundi-lo economizaria uma mensagem e quebraria o pagamento.
- **O QR Code.** O plano mandava cortá-lo ("quem paga pelo celular usa o copia-e-cola"). Mas a imagem já ia de qualquer forma e tinha uma legenda desperdiçada — pôr os dados nela rende a mesma mensagem economizada **sem** tirar o QR de quem lê de outra tela.

**O indicador de digitação — duas ressalvas honestas.** É o endpoint de marcar-como-lida com `typing_indicator` junto: não é mensagem, não entra na franquia de 1.000/mês. (1) O balão some após ~25 s; se OCR + Odoo passarem disso, a pessoa fica sem sinal — o mesmo que já acontecia depois do "Analisando..." antigo. (2) Se a Meta recusar a chamada, `sinalizarProcessando` devolve `false` e **o texto volta**: o corte é grátis quando funciona e inofensivo quando não. **Conferir no Cloud Logging, após o deploy, se aparece `⚠️ [WhatsApp] Indicador de digitação recusado`** — é a única parte deste item que não pôde ser testada fora da Meta.

O mesmo tratamento foi dado ao `⏳ Salvando seu cadastro...`, que tem exatamente a mesma natureza.

**Em dinheiro:** de **R$ 87,50** para **R$ 35,00/mês** no cenário de 500 devoluções. Queda de 60% — desproporcional ao corte de mensagens porque as 500 devoluções passam a caber quase inteiras na franquia de 1.000.

**Aceite:** uma devolução completa gera 3 mensagens do bot, e nenhuma informação que estava na tela deixou de estar. Cinco regras do harness guardam isso (legenda completa, copia-e-cola intacto, dados do OCR no resultado, linha do histórico, legenda longa demais).

---

### BL-38 — Entrada do bot: uma boas-vindas e um menu que decide pelo número 🟠 (M) — ✅ concluído em 18/09/2026
**Arquivos:** `MenuHandler.gs` · `Webhook.gs` · `CadastroHandler.gs` · `Router.gs` · `DevolucaoHandler.gs`
**Base:** `Documentação/FLUXOS.md` §3 · verificado por `node ferramentas/conta-mensagens.js`

**O problema.** Toda pessoa passa pela entrada, e ela custava 4 mensagens antes da primeira escolha útil — 6 para quem já era dizimista. Três delas existiam para descobrir **pelo número** algo que o número já dizia: o WhatsApp entrega o telefone em toda mensagem recebida, e é por ele que o Odoo é consultado. O bot perguntava "você já é dizimista?", e depois ignorava a resposta e consultava o telefone.

**O que mudou:**
1. **Boas-vindas viraram uma mensagem.** Eram a imagem com legenda curta + um texto com o resto. A legenda da imagem já carrega texto — as duas viraram uma, com o mesmo conteúdo na tela. Sem avatar no Odoo, vira texto simples: ainda uma mensagem.
2. **A entrada decide pelo número** (`MenuHandler.entrada`). Número novo vai direto ao formulário de cadastro; número cadastrado recebe o menu de dizimista. A mensagem que abriu a conversa não é roteada — era só o "oi".
3. **`btn_ja_sou_dizimista` saiu dos menus.** Com ele foram as duas mensagens de identificação ("🔍 Buscando seu cadastro...", "✅ Cadastro encontrado").
4. **`menuPrincipal` passou a decidir pelo número também**, para que o menu digitado (`menu`) e o menu de entrada não divirjam.

**Resultado, conferido pelo harness:** primeiro contato **4 → 2**; quem já é dizimista e chega à devolução pelo menu, **6 → 2**.

**Três decisões que não são óbvias:**

- **O histórico não coube.** O WhatsApp aceita no máximo 3 botões, e Devolver / Adicionar membro / Contato Pastoral já ocupam os três. Em vez de gastar uma quarta mensagem, virou uma linha **dentro** da devolução (`_linhaUltimaDevolucao`), na mensagem de dados de pagamento que já seria enviada — custo zero — mais o atalho digitando `histórico`, que funciona em qualquer ponto.

- **Os botões antigos continuam atendidos.** `btn_ja_sou_dizimista` e `btn_minhas_devolucoes` saíram dos menus, mas as mensagens antigas seguem na conversa de cada pessoa e o toque nelas chega ao webhook normalmente. Remover os `case` do `Router.gs` transformaria um botão antigo em silêncio. `verificarDizimista` virou um encaminhamento para `MenuHandler.entrada`.

- **Primeira mensagem com intenção não vira menu.** Quem a secretaria cadastrou no Odoo e nunca escreveu ao bot recebe o lembrete mensal e toca "Devolver agora" — e essa é a primeira mensagem dele. O `Webhook.gs` roteia mensagens `interactive`/`button` do primeiro contato em vez de mandar o menu, senão o lembrete custaria um toque a mais logo para quem ele foi buscar.

**Degradação com o Odoo fora do ar:** `entrada` e `menuPrincipal` agora consultam o Odoo, e os dois são destino de fallback — inclusive de fallbacks que existem para quando o Odoo falha. Uma exceção ali deixaria a pessoa sem resposta nenhuma, então ambos caem no menu genérico em vez de propagar. Há cenário no harness para isso.

**Novo:** `ferramentas/conta-mensagens.js` carrega os `.gs` de verdade num contexto isolado, troca só a borda (nada sai pela rede, nada toca o Odoo) e confere a contagem contra `FLUXOS.md`. Sai com código 1 se divergir. Existe porque número em documento envelhece calado: bastava alguém acrescentar um `Utils.enviarSimples` para o documento passar a mentir sem que nada falhasse.

---

### BL-39 — Cadastro duplicado: o mesmo número virava dois dizimistas 🔴 (P) — ✅ concluído em 18/09/2026
**Arquivos:** `OdooService.gs` (`criarDizimista`) · `CadastroHandler.gs` (`finalizar`) · `FlowHandler.gs` (`_processarCadastro`)

**O problema.** O cadastro conferia se o número já existia ao **começar** (`iniciar`), e não ao **terminar**. Entre um e outro cabe muita coisa:

- tocar num formulário de meses atrás — a mensagem do Flow continua na conversa da pessoa, e o toque nela chega ao webhook como uma submissão nova;
- tocar duas vezes em "Confirmar cadastro", gerando duas execuções do Apps Script com ~400 ms de diferença;
- completar o cadastro por conversa num aparelho enquanto o formulário de outro já gravou.

Qualquer um criava um **segundo** `x_dizimista` com o mesmo telefone. E `buscarDizimistaPorWhatsapp` devolve `registros[0]` — então devoluções e lembretes passavam a cair num registro e o histórico no outro, **em silêncio**. Nada falhava; os dados é que divergiam.

**A correção, e por que ela mora no OdooService.** A guarda ficou em `criarDizimista`, não nos handlers: é o ponto por onde todo cadastro obrigatoriamente passa — conversa e formulário. No handler, consertaria os caminhos de hoje e não os de amanhã. Ela lança um erro com `.codigo === OdooService.ERRO_JA_CADASTRADO` e `.dizimista`, de modo que quem chama responde com o menu do dizimista em vez de "ocorreu um erro" — dizer "erro" faria a pessoa tentar de novo, repetindo a tentativa que acabou de ser barrada.

A verificação e a gravação ficam dentro de um `LockService.getScriptLock()`. Sem ele, duas execuções simultâneas passariam as duas pela busca antes de qualquer uma criar — que é exatamente o caso do toque duplo. Mesmo padrão de `StateManager.ehPrimeiroContato`.

`FlowHandler._processarCadastro` também confere, mas **por usabilidade, não por segurança**: sem isso a pessoa preencheria o formulário inteiro, mandaria a foto, veria o resumo e só então seria barrada. A guarda do `OdooService` continua sendo a que não pode falhar.

**Aceite:** responder um formulário antigo não cria registro e devolve **uma** mensagem (o aviso vai junto do menu). Cenário no harness.

---

### BL-40 — Card de pagamento nativo do WhatsApp 🟠 (M) — ✅ **sonda passou em 19/09/2026**
**Arquivos:** `TestePixNativo.gs` (sonda) · eventualmente `DevolucaoHandler.gs` e `MediaService.gs`
**Origem:** teste do app concorrente **Dizify**, 19/09 — ele mostra um card de pagamento com botão nativo **Copiar código Pix**.

#### O que é

A **API de Pagamentos do WhatsApp para o Brasil**: mensagem interativa `order_details` com `payment_settings: [{ type: "pix_dynamic_code" }]`. Renderiza um card com nº da cobrança, total e o botão nativo de copiar.

#### Por que interessa

Resolve a **única** mensagem que o BL-37 não conseguiu fundir. O copia-e-cola tem que ir sozinho e sem formatação, senão o toque longo → Copiar não leva o código exato e o app do banco recusa. Com o botão nativo, ele vira parte do card: **devolução de 3 → 2 mensagens**.

#### A descoberta que divide a decisão em duas

Os campos do `pix_dynamic_code` são `code`, `merchant_name`, `key`, `key_type`. **O `code` é uma string que nós fornecemos** — não há campo apontando para provedor de pagamento. Isso sugere que a MENSAGEM não exige PSP; quem exige é a CONCILIAÇÃO.

| | O que ganha | O que custa |
|---|---|---|
| **(A) Só o botão** | 3 → 2 mensagens; dinheiro continua caindo direto na conta da comunidade | Nada, se a Meta aceitar. O comprovante e o OCR ficam |
| **(B) Conciliação automática** | 3 → 1 mensagem; morrem o OCR, o **BL-14** e o **BL-26** | PSP, tarifa, intermediário: **R$ 150–500/mês** |

#### Pesquisa de PSP e tarifas (19/09/2026)

Um padrão se repete em todos: **a isenção acaba exatamente onde a API começa.**

| PSP | Taxa zero | O que fica de fora |
|---|---|---|
| Asaas | 100 transações/mês | Só chave ou QR **estático**. Dinâmico/fatura paga tarifa contratual (~R$ 0,99–1,99) |
| Efí | 30 transações/mês | Só app/chave/QR estático. Via **API/webhook**: **1,19%** desde a primeira |
| Mercado Pago | — | 0,99% (0,79–0,89% com volume) |
| Stark Bank | — | ~R$ 0,50 fixo — **fonte de 2022, confirmar** |

A faixa gratuita cobre exatamente o que o bot faz hoje (BR Code estático) e para onde a API de Pagamentos começa. **Não se paga pelo PIX; paga-se por saber que o PIX aconteceu.**

**Cooperativas:** Sicoob e Sicredi anunciam isenção de PIX para PJ, variando por cooperativa e pacote. Se a paróquia já tem conta numa delas, o recebimento direto de hoje provavelmente custa R$ 0. Há projeto no Senado isentando doações a entidades sem fins lucrativos — encontrado como **aprovação em comissão (2023)**, não lei sancionada; não confiar sem checar.

**Custo da opção (B)**, 500 devoluções/mês (dízimo médio é hipótese — confirmar o real):

| Dízimo médio | 1% | 1,19% | R$ 0,50 fixo |
|---|---|---|---|
| R$ 30 | R$ 150/mês | R$ 179/mês | R$ 250/mês |
| R$ 50 | R$ 250/mês | R$ 298/mês | R$ 250/mês |
| R$ 100 | R$ 500/mês | R$ 595/mês | R$ 250/mês |

Comparação: o bot inteiro custa **R$ 35/mês**. A tarifa seria 5 a 15× isso. A partir de ~R$ 50 de dízimo médio, tarifa fixa passa a ganhar da percentual.

O acréscimo de **R$ 2,49** que o Dizify oferece antes da cobrança ("despesas administrativas") é onde essa tarifa volta para alguém. Nosso bot poderia fazer igual — decisão pastoral, não técnica.

#### O que NÃO foi verificado

⚠️ **A documentação oficial da Meta está bloqueada pelo proxy da sessão.** Tudo acima vem de fontes secundárias. Três dúvidas decidem se (A) é viável:

1. A Meta exige configuração de pagamento aprovada na conta?
2. Ela valida que o código é dinâmico de verdade (emitido por PSP)?
3. Entidade religiosa é elegível?

Descartado: o botão `COPY_CODE` de template existe, mas é restrito a templates de cupom/autenticação — não serve para PIX.

#### A sonda

`testarPixNativo('<numero>')`, no editor do Apps Script. Monta um `order_details` com o BR Code que o bot já gera, envia pelo `Utils._post` de sempre (para valer a conferência do BL-32 e o contador do BL-25) e imprime a resposta crua da Meta. Responde as três dúvidas com um envio, e custa menos que qualquer conversa comercial com PSP — **tem que vir antes dela**.

Junto veio `tipoDaChavePix()`: o card exige `key_type` e o Odoo guarda só a chave. Desempata CPF de celular pelo dígito verificador — classificar por tamanho chamaria todo celular sem `+` de CPF, e a Meta recusaria sem explicar. Coberto no harness.

#### ✅ VEREDITO DA SONDA — 19/09/2026

**A Meta aceitou.** HTTP 200 e o card renderizou no aparelho, com o botão nativo **Copiar código Pix**, usando o BR Code que o bot já gera — **sem PSP, sem onboarding de pagamentos, sem intermediário**.

As três dúvidas, respondidas de uma vez:

1. ~~A Meta exige configuração de pagamento aprovada?~~ **Não** — a conta atual, sem nenhum setup de pagamentos, enviou e renderizou.
2. ~~Ela valida se o código é dinâmico de verdade?~~ **Não** — o campo se chama `pix_dynamic_code`, mas aceitou um BR Code estático gerado localmente.
3. ~~Entidade religiosa é elegível?~~ **Pergunta sem efeito**, já que não há processo de habilitação envolvido.

**Consequência:** a opção (A) está liberada e é gratuita. A opção (B) — PSP, R$ 150–500/mês — continua sendo a única forma de ter conciliação automática, e agora é uma decisão puramente econômica, desacoplada do botão.

#### ⚠️ O que a sonda NÃO provou

Ela provou que a **mensagem** é aceita e o card **renderiza**. Não provou que o código copiado **paga**. São coisas diferentes: a Meta não valida o conteúdo do BR Code, então um payload malformado renderizaria igual e só falharia no app do banco.

**Antes de implementar:** copiar o código do card e colar no app do banco, conferindo se resolve para a conta da comunidade e com o valor certo. É o mesmo BR Code que o bot já manda hoje como texto, então a expectativa é que funcione — mas "expectativa" não é teste.

#### Decisões que a implementação precisa resolver

- **O QR Code some?** O card substituiria a imagem do QR + o copia-e-cola (2 mensagens → 1, devolução de 3 → 2). Mas quem paga de outra tela perde o QR escaneável. O BL-37 já tinha marcado o QR como "o único corte com perda, e pequena" — agora a perda seria em troca de um botão nativo, que é melhor que o copia-e-cola cru.
- **`order_status`.** O card é enviado com `order.status: "pending"`. A API tem mensagens de `order_status` para fechar o pedido; sem elas, o pedido pode ficar pendente para sempre no WhatsApp da pessoa. Vale sondar se dá para marcar como pago quando o comprovante é confirmado — seria um fechamento visual, e talvez outra mensagem cobrada.

#### ✅ IMPLEMENTADO — 19/09/2026

O código do card foi colado num app de banco e **pagou corretamente**, para a conta da comunidade e com o valor certo. Era o que faltava: renderizar o card não é o mesmo que o código funcionar.

- `MediaService.enviarCardPix()` monta e envia o `order_details`.
- `DevolucaoHandler._entregarPagamento()` é o ponto único dos dois caminhos (individual e família): tenta o card e **cai no QR + copia-e-cola se a Meta recusar**. Esta é a mensagem por onde o dinheiro passa — nunca deixar a pessoa em `AGUARDANDO_COMPROVANTE` sem ter como pagar. O harness cobre os dois caminhos.
- `Utils.tipoDaChavePix()` saiu da sonda e virou utilitário.

**Decisão sobre o QR:** sai. Quem pagava lendo de outra tela perde a imagem; quem paga no próprio aparelho — a maioria — ganha um botão nativo, que nem depende de toque longo. Troca consciente.

**Resultado:** devolução de **3 → 2 mensagens**. Com isso as 500 devoluções passam a caber **inteiras** na franquia de 1.000, e a conta mensal cai de R$ 35,00 para **R$ 17,50** — só o template do lembrete, que não tem franquia.

#### 🔬 Aberto: quanto custa fechar o pedido (`order_status`)

O card nasce `pending` e o WhatsApp cria um PEDIDO no aplicativo da pessoa. A API tem `order_status` para fechá-lo; sem isso, o pedido provavelmente fica pendente para sempre, mesmo depois de a pessoa pagar.

O lugar certo de marcar como pago é **depois do OCR confirmar o comprovante**. A dúvida não é *quando* — é *quanto custa*:

```
Card (1) + resultado do OCR (1)                 = 2 mensagens ✅
Card (1) + resultado (1) + order_status (1)     = 3 — o que já tínhamos
```

Se for cobrado como mensagem de serviço, anula o ganho inteiro e a decisão passa a ser deixar o pedido pendente mesmo.

**Sonda pronta:** `testarPixNativoPago()`, depois de `testarPixNativo()`. Rodar `verificarConsumoMensagens()` antes e depois — se o contador de serviço subir, é cobrado. Atenção à janela de 24h: uma recusa pode ser só isso, não a ausência do recurso.

**Aceite:** decidir, com o número medido, se o pedido é fechado ou fica pendente.

---

### BL-41 — Oferta como contribuição própria 🟠 (G) — 🔄 **em execução agendada desde 19/09/2026**

**Origem:** comparação com o app Dizify, que separa dízimo de oferta. Decidido com o usuário em 19/09: oferta **vai para a comunidade**, **não exige cadastro**, e o registro usa **campo novo** em `x_devolucao` (não modelo separado).

#### A decisão estrutural (opção 1, confirmada)

`x_studio_comunidade` é hoje `related` a `x_studio_dizimista.x_studio_comunidade`, **stored e readonly**. Sem dizimista, a oferta gravaria sem comunidade — e a comunidade é o que diz para qual conta o dinheiro foi, e por onde os relatórios filtram.

Três saídas foram avaliadas:

1. **Tornar `x_studio_comunidade` gravável** ← escolhida. Modelo honesto: a oferta tem comunidade, ela só não chega por uma pessoa. Só 2 pontos de escrita a ajustar, e nenhuma das 6 consultas muda de nome.
2. Segundo campo `x_studio_comunidade_oferta` — sem migração, mas empurra um `coalesce` para toda consulta futura, para sempre.
3. "Dizimista fantasma" por comunidade — **rejeitada**: `buscarDizimistaPorWhatsapp` acharia o registro e trataria a pessoa como cadastrada (menu de dizimista, lembrete mensal, contagem do relatório). Mesma classe de erro do BL-39.

**Feito agora porque todos os dados do Odoo são de teste.** Depois de 500 dizimistas reais, é outro animal.

#### Como o código chega antes do schema

O BL-26 já resolveu isso: `OdooService.campoExiste('x_devolucao', 'x_studio_conferencia_pix')`. Mesma técnica aqui — **todo código desta fila pergunta ao Odoo se o campo existe antes de usá-lo e degrada sozinho**. Assim a trilha A é mergeada e publicada sem depender da migração, e o comportamento novo liga quando a migração acontecer.

#### 🔄 TRILHA A — automática (execução de hora em hora, a partir das 04:01 de Brasília)

Cada execução trabalha **quantos itens conseguir**, em ordem, deixando o harness verde a cada commit. Marque aqui ao concluir.

Se um item exigir decisão que não está escrita aqui: **não chute — pule**, registre uma linha `⏭️ PULADO (execução automática):` com a pergunta e as opções, e siga para o próximo.

- [x] **A1.** `_enviarContatos` → mensagem tipo `contacts` (cartão nativo com "Conversar"). ✅ 19/09 — contexto da comunidade vai no campo de organização, dentro do cartão, para o caminho continuar em 1 mensagem; texto antigo mantido como reserva se a Meta recusar
- [x] **A2.** `SetupCamposOferta.gs`. ✅ 19/09 — 4 funções separadas por risco: `conferirMigracaoOferta()` (só lê) → `criarCamposOferta()` (aditivo) → `tornarComunidadeGravavel()` (⚠️ travado por `MODO_TESTE`, mede a contagem antes e depois) → `backfillTipoContribuicao()`
- [x] **A3.** `registrarDevolucao` exige comunidade e grava tipo + telefone. ✅ 19/09 — precisou de `campoGravavel()` novo: `campoExiste` não bastava, porque `x_studio_comunidade` já existe e só muda de readonly para gravável; escrever antes da migração faria o Odoo recusar a gravação INTEIRA
- [x] **A4.** Gerador de massa preenche comunidade e tipo. ✅ 19/09 — o comentário antigo ("comunidade NÃO é gravada: é related", BL-05) virou o oposto depois da migração; gera só `dizimo`, porque massa fictícia de oferta enganaria quem for conferir o relatório por tipo
- [x] **A5.** Leitura filtrada. ✅ 19/09 — helper `_comTipo()`, com o padrão decidido POR FUNÇÃO e justificado no código:
      `devolucoesDoMes` e `buscarDevolucoesDizimista` → só `dizimo` (senão quem ofertou leva "você já devolveu este mês");
      `listarDevolucoesPorPeriodo` → `dizimo` por padrão, aceita `'oferta'` e `null`;
      `buscarDevolucoesPendentes` e `buscarDevolucaoDetalhada` → **não filtram** (comprovante de oferta também precisa de conferência), mas passam a trazer o campo para a tela dizer o que é.
      7 regras no harness, incluindo a de que **antes da migração não filtra** — filtrar por campo inexistente derrubaria o `search_read` inteiro
- [x] **A6.** Menu novo + submenu em lista. ✅ 19/09 — `btn_oferta` também no menu de quem NÃO é cadastrado, já que oferta não exige cadastro. Para não subir botão morto, o `OfertaHandler` foi junto, pelo caminho de conversa (comunidade → valor → card do BL-40)
- [x] **A7.** `ferramentas/flow-oferta.json`. ✅ 19/09 — Dropdown de comunidade + valor; passou no `valida-flow.js`. Os ids do Dropdown vão como **string**: id numérico é recusado na renderização, sem erro no envio
- [x] **A8.** `FlowHandler` da oferta. ✅ 19/09 — `TOKEN_OFERTA`, `_processarOferta` (revalida no servidor, porque a validação do Flow roda no cliente), `enviarFlowOferta`, estado `AGUARDANDO_FLOW_OFERTA`. ⚠️ Depende da Script Property **`FLOW_ID_OFERTA`** — sem ela a oferta segue pela conversa, sem quebrar
- [x] **A9.** Handler de oferta. ✅ 19/09 — feito junto do A6 para não existir botão sem destino. Caminho de conversa completo; o formulário (A7/A8) entra por cima
- [x] **A10.** "Convidar alguém". ✅ 19/09 — **agora manda o CARTÃO DE CONTATO do bot + o texto (2 mensagens).** Encaminhar um link exige que a outra pessoa toque nele; encaminhar um contato deixa o bot salvo na agenda dela. `contacts` é um tipo de mensagem inteiro e não aceita corpo junto, como botões e formulário não se misturam — daí as duas. O texto é escrito DEPOIS do cartão e conforme ele ter saído: prometer um contato que a Meta recusou deixaria a pessoa procurando o que não existe. Cartão recusado → volta ao link. **Bug corrigido junto:** o link saía como `wa.me/86981622537`, sem o 55, e o `wa.me` lia o 86 como China — o convite não levava a lugar nenhum
- [x] **A11.** `FLUXOS.md`: seção 5b com o fluxo da oferta, contagens e o custo do submenu. ✅ 19/09

#### ✅ DESBLOQUEADO PELA S1

- [x] **A12.** Entrada com cabeçalho de imagem. ✅ 19/09 — **todo primeiro contato cabe em UMA mensagem.** Era 2; antes do BL-38, 4.
  - **Dizimista** (sonda S1): avatar, boas-vindas e os 3 botões do menu do dizimista num balão.
  - **Número novo**: avatar, boas-vindas e os 3 botões de `menuPrincipal` — **Ser Dizimista / Oferta / Contato Pastoral**.
  - **A decisão que mudou no caminho.** Primeiro a entrada de número novo mandava o formulário direto, com cabeçalho de imagem por link (sonda S10). Era o caminho mais curto até o cadastro — e o **único visível**: quem só queria ofertar, ou falar com a pastoral, chegava num beco sem saída. `menuPrincipal` existe exatamente para isso e só aparecia depois. Trocado por decisão do usuário: cadastro custa 1 mensagem a mais, uma vez por pessoa; oferta e contato deixam de ser invisíveis. **Oferta não exige cadastro — esconder isso de quem chega perde a oferta inteira, não uma mensagem.**
  - O cabeçalho de imagem no flow foi removido junto, por não ter mais chamador. A descoberta continua registrada na sonda S10 e aqui.
  - Caminhos de reserva: sem avatar no Odoo e Odoo fora do ar voltam a 2 mensagens. A entrada não depende mais do interruptor do formulário — o menu não é um flow.
  - Quando a primeira mensagem já traz intenção (o botão do lembrete), as boas-vindas seguem sozinhas: não há o que fundir.

#### 👤 TRILHA B — só você consegue fazer

- [x] **S1.** ✅ **19/09, 11:19 — mensagem de BOTÕES renderiza cabeçalho de imagem.** Confirmado no aparelho: as 3 chegaram, a do meio com a imagem em cima do texto e dos botões. **A12 desbloqueado e implementado.**
  - Foram **quatro rodadas**, e as três primeiras não responderam nada — vale registrar por quê, porque o padrão se repete:
    1. `NUMERO_TESTE is not defined` — a sonda usava uma constante de `Tests.gs`, que o `.claspignore` corta. Existia no repositório, nunca no Apps Script
    2. só o controle chegou. A sonda lia `media_id_avatar` cru, pulando as travas de `MediaService._mediaIdEmCache` — um id vencido é aceito com HTTP 200 e descartado na entrega, e eu teria lido isso como "cabeçalho recusado", matando o A12 pelo motivo errado
    3. `comImagem is not defined` — definição apagada num refactor meu
  - **A lição de método:** `HTTP 200` com `wamid` não é entrega. A Meta aceita e descarta em silêncio; `Webhook.gs:149` loga o motivo real quando o webhook chega. Todo teste de renderização se decide no aparelho.
  - A sonda ficou com 4 braços: `GET /<media-id>` (síncrono, não gasta mensagem), a imagem sozinha, os botões com cabeçalho e os botões sem. Sem o braço da imagem sozinha, "a 2 não chegou" tem duas causas e nenhuma forma de separá-las.
- [x] **S2.** ✅ **Migração feita em 19/09, 09:23.** `x_studio_comunidade` (id 8310) deixou de ser `related` e virou gravável. **Contagem preservada: 5150 → 5150** — os valores sobreviveram, que era a única dúvida real do passo. Campos criados: `x_studio_tipo_contribuicao` (id 8797) e `x_studio_telefone_ofertante` (id 8799)
- [x] **S3.** ✅ **Backfill feito em 19/09, 09:27** — 15 registros marcados como `dizimo`, e a varredura final voltou 0 pendentes. (Os ~5.150 restantes eram massa de teste, apagada pelo usuário entre o passo 2 e este.) O sucesso da gravação **confirma que as opções do selection foram criadas certo** via `selection_ids` — parte que não dava para testar fora do Odoo
- [ ] **S4.** `testarPixNativoPago()` + `verificarConsumoMensagens()` antes/depois — custo do `order_status` (BL-40)
- [x] **S5a.** `clasp push` ✅ (as funções do setup rodaram, logo o código novo está lá)
- [x] **S5b.** ✅ 19/09 — deployment republicado
- [x] **S8.** ✅ 19/09, 09:32 — **zero dizimistas ativos sem comunidade.** Ninguém esbarra no erro novo de `registrarDevolucao`. Vale rodar de novo sempre que importar cadastro de fora do bot
- [x] **S7.** ✅ 19/09 — formulário de oferta publicado e `FLOW_ID_OFERTA` configurado. Republicado depois da correção da comunidade pré-selecionada
- [x] **S9.** ✅ 19/09 — `criarCamposOferta()` rodado de novo, `x_studio_nome_ofertante` criado
- [x] **S10.** ✅ **19/09, 12:11 — flow aceita cabeçalho de imagem, mas só por LINK.** Duas rodadas: a 1ª devolveu `(#131008) header image must contain link` com `image.id`; a 2ª, com `AVATAR_URL` apontando para `docs/avatar.png` no GitHub Pages, chegou com a imagem em cima. **A12 fechado.** Na 1ª rodada o veredito da sonda lia HTTP 400 como recusa e teria matado o A12 por engano — passou a ler o `details`. Houve ainda uma rodada perdida porque o `avatar.png` estava no `main` e o Pages construía do `staging`: a URL não abria
- [x] **S6.** ✅ 19/09 — **deixou de ser tarefa.** O webhook passou a guardar `WHATSAPP_NUMERO_BOT` a partir do `metadata.display_phone_number`, que a Meta manda em TODO callback, de graça. É o número dito por quem o registrou, e vem antes da `WHATSAPP_NUMERO_EXIBICAO` digitada à mão — que foi justamente a que entrou sem o código do país. A escrita só acontece quando o valor muda; um `setProperty` por mensagem recebida seria uma escrita por conversa para gravar sempre a mesma coisa


### BL-43 — O arnês de testes só roda quando o Claude está no meio do caminho 🟡 (P)

**Adiado por decisão do usuário em 19/09** ("agora não"). Registrado para não se
perder.

**O problema.** `ferramentas/conta-mensagens.js` tem 99 verificações e pegou
vários bugs antes de chegarem em produção — `tipoDaChavePix` chamada solta,
`comImagem` apagada num refactor, `wa_id` sem código de país. Mas **não existe
`.github/workflows`**: nada o executa sozinho.

Na prática ele roda antes de cada commit porque o Claude o roda. Quem editar um
`.gs` direto pelo GitHub, ou no editor do Apps Script e der push, não passa por
verificação nenhuma — e é justamente o caminho em que ninguém está olhando.

**A saída.** Uma GitHub Action que rode `node ferramentas/conta-mensagens.js`
em todo push e todo PR. Sem dependência para instalar: o script usa só a
biblioteca padrão do Node, e já sai com código 1 quando algo diverge — foi
escrito para CI desde o começo, e o cabeçalho dele diz isso.

**Custo:** pequeno. O que o adia não é dificuldade, é prioridade.

**Enquanto não existe:** `node ferramentas/conta-mensagens.js` antes de
publicar, quando a edição for sua. Não envia mensagem nem toca o Odoo.


### BL-44 — Cadastro por conversa desligado: o formulário vira o único caminho 🟠 (P) — ✅ concluído em 19/09/2026
**Arquivos:** `CadastroHandler.gs` (`conversaAtiva`) · `Router.gs` · `MenuHandler.gs` (`lembrarCadastroPendente`) · `Setup.gs`

**A decisão.** O passo a passo custa **19 mensagens**; o formulário, 4. Ele existia para quem não conseguisse abrir o formulário — não como rota principal. Desligado.

**Interruptor, não remoção.** `CADASTRO_CONVERSA_ATIVO`, desligado por padrão: só `'true'` liga, mesma convenção do `FLOW_CADASTRO_ATIVO`. **O código do passo a passo continua inteiro.** Se o formulário der problema, `ativarCadastroPorConversa()` devolve o caminho antigo sem republicar nada.

**Quem escreve com o formulário aberto** recebe um lembrete com Oferta e Contato Pastoral — uma mensagem, os dois botões no mesmo balão. Resolve o BL-34 por um caminho que não estava nas opções: não perguntar nem decidir, lembrar.

**A armadilha que isto criou, e a trava.** A conversa era a rede embaixo do formulário. Sem ela, desligar o formulário deixaria a paróquia **sem caminho de cadastro nenhum, em silêncio** — e `desativarFlowCadastro()` ainda dizia "volta ao cadastro por conversa". As duas funções passam a avisar quando a outra está desligada, e `CadastroHandler.iniciar` grita no log (`console.error`) quando o formulário falha sem rede, em vez de deixar a pessoa sem resposta: ela recebe um pedido de desculpas e o contato da pastoral.

**Membro entrou junto.** Adicionar familiar por conversa são 14 mensagens contra 4 — a mesma coisa que cadastrar dizimista por conversa, campo por campo. Mesmo interruptor, porque desligar um e deixar o outro seria uma distinção sem diferença.

**Devolução e oferta ficaram de fora, por motivos diferentes.** A devolução não tem conversa alternativa: são 2 mensagens (QR com os dados na legenda + copia-e-cola) e ponto. Já a oferta **tem**, mas são **5 mensagens contra 3** — economia de 2, não de 15 — e desligá-la significa perder a oferta quando o formulário falhar. Cadastro pode esperar; oferta é um momento.

**O `Router.gs` entrou no arnês.** Ficava de fora, e por isso o ramo que decide tudo isso não era executado por teste nenhum. Entraram quatro verificações: o lembrete, o interruptor devolvendo o caminho antigo, o formulário fora do ar sem rede, e uma regra de conteúdo que exige as duas saídas no lembrete — sem elas ele vira um muro.


### BL-45 — O botão "Corrigir" cancelava o cadastro 🔴 (P) — ✅ concluído em 19/09/2026
**Arquivos:** `ferramentas/flow-cadastro.json` · `FlowHandler.gs` (`_dadosPreenchidos`) · `CadastroHandler.gs` (`corrigir`) · `Router.gs`

**O problema.** Na tela de confirmação, "❌ Corrigir" chamava `cancelar()`: apagava os **sete campos** preenchidos e mandava "Cadastro cancelado". A pessoa via um dado errado, tocava no botão que prometia consertar, e perdia tudo — sem aviso. O botão dizia uma coisa e fazia outra.

**A correção.** O formulário volta **preenchido**. O padrão já existia no projeto: o formulário de oferta recebe o nome por `init-values` ligado a `${data.nome_padrao}`. O de cadastro ganhou sete campos assim.

**A comunidade fica de fora, de propósito.** O Dropdown segue a **regra 6** do `valida-flow.js`, que nasceu quando a primeira comunidade vinha pré-selecionada e podia mandar o dinheiro de alguém para o lugar errado. Um valor inicial ali teria de existir também no PRIMEIRO envio, quando não há nada para preencher — e desde o BL-44 o formulário é o **único** caminho de entrada. Não é onde se experimenta. Quem corrige escolhe a comunidade de novo, um toque.

**A armadilha da Meta.** Ela recusa a mensagem inteira se um campo declarado em `data` não vier, ou vier com o tipo errado: `valor_mensal` é `input-type: number`, e mandar `"150"` como texto derruba o envio. Todos os sete saem sempre, vazios no primeiro envio, e os numéricos saem como número. Três verificações cobrem isso — uma delas carrega o `FlowHandler` REAL num contexto próprio, porque no resto do arnês ele é stub.

**O id do botão ficou como estava** (`btn_cancelar_cadastro`). Mensagens antigas na conversa ainda carregam esse valor; renomear faria elas pararem de responder.

⚠️ **Exige republicar o Flow de cadastro na Meta** — o JSON mudou.


### BL-46 — Conferir o comprovante contra o cadastro da comunidade 🟠 (M) — ✅ concluído em 19/09/2026
**Arquivos:** `VisionService.gs` (`_extrairRecebedor`) · `ComprovanteHandler.gs` (`_conferirComprovante`, `_fraseDesfecho`) · `Config.gs` (`alertaDoador`)

**O que já existia.** O BL-26 conferia a **chave PIX** e marcava a devolução para conferência da secretaria. Faltavam o **nome do titular** e o **banco**.

**O achado que mudou o desenho.** `_extrairBanco` devolvia o **primeiro** banco encontrado no texto — que num comprovante é o app de **quem pagou**, no topo da tela. Comparar aquilo com a conta da paróquia reprovaria quase todo comprovante legítimo. E nome não era extraído de forma alguma.

Então a extração passou a ser **ancorada**: acha o rótulo que abre o bloco do recebedor (`Para`, `Destino`, `Beneficiário`, `Recebedor`…), lê dali até o bloco do pagador, e só. Mesmo caminho que `_extrairChavePix` já usava com "Chave Pix:".

**A assimetria do erro decide o resto.** Deixar passar um comprovante errado custa uma conferência da secretaria. Acusar um comprovante certo custa dizer a alguém que acabou de devolver o dízimo que ela pagou errado. Daí três regras:

- **`null` nunca conta contra ninguém.** Layout não reconhecido é "não sei", não "não confere".
- **Nomes comparam por palavra significativa**, sem acento e sem caixa. `PAROQUIA N S CONCEICAO` e `Paróquia Nossa Senhora da Conceição Aparecida` são a mesma conta escrita por dois sistemas; divergente é só quando **nenhuma** palavra coincide.
- **A chave manda.** Nome e banco só decidem quando ela não pôde ser lida — e aí precisam divergir **os dois**.

**Quem é avisado.** `alertaDoador` é bem mais restrito que `exigeConferencia`, e código desconhecido **não** alerta — o oposto do outro, de propósito: no silêncio, o lado seguro lá é conferir, aqui é calar.

| situação | secretaria confere | pessoa é avisada |
|---|---|---|
| chave de outra conta | sim | **sim** |
| sem chave + nome e banco divergem | sim | **sim** |
| chave certa, nome estranho | sim | não |
| só o banco diverge | sim | não |
| layout não reconhecido | sim | não |

**A frase de desfecho virou um lugar só.** Estava escrita em três (individual, família e oferta) e já divergia entre elas.


### BL-49 — A chave extraída podia ser o CNPJ da instituição 🔴 (P) — ✅ concluído em 19/09/2026
**Arquivos:** `VisionService.gs` (`_blocoDoRecebedor`, `_chaveEmLinhas`, `_nomeNoBloco`)

**O achado.** Num comprovante do Nubank, `_extrairChavePix` devolvia `18.236.120/0001-58` — o CNPJ da **Nu Pagamentos S.A.**, do rodapé. O bloco "Destino" do Nubank não traz Chave Pix, e a varredura descia o comprovante inteiro até achar algo com formato de chave.

**Por que isso era grave, e não apenas errado.** Desde o BL-46, chave divergente **avisa a pessoa** de que o pagamento dela parece estar errado. Todo comprovante do Nubank sem chave no destino cairia nisso — acusação falsa contra quem pagou certo, no momento em que ela acabou de devolver o dízimo. Foi encontrado antes de ir para produção, com comprovantes reais.

**A correção.** A chave passa a ser procurada **só no bloco de quem recebeu**. Quando o bloco existe e não tem chave, a resposta é `null` — "não há chave para conferir" — e **não** se cai para o resto do comprovante, que é justamente onde mora o rodapé.

**Quatro layouts, quatro defeitos diferentes:**

| comprovante | o que quebrava |
|---|---|
| Nubank sem chave no destino | o CNPJ do rodapé virava a chave |
| Banco do Brasil | Agência e Conta empurram a Chave Pix para fora da janela de 8 linhas (virou 14); e a chave vem sem pontuação, em linha separada do rótulo |
| Inter empresas | o rótulo "Quem recebeu" tem duas palavras e só letras — saía como se fosse o nome |
| Nubank em geral | `Nome THALLES BOITEUX VALE` sem dois-pontos deixava o rótulo colado no nome |

**CPF/CNPJ sem pontuação só é aceito depois do rótulo "Chave Pix".** Número de conta tem o mesmo tamanho, e aceitar em qualquer linha traria conta por chave.

**Os seis comprovantes viraram teste**, transcritos como o OCR os entrega. Um exemplo genérico não teria encontrado nenhum destes.


### Correção de registro — a cidade do BR Code (19/09)

A mensagem de commit do **BL-48** afirmou que o card passaria a usar
`comunidade.x_studio_cidade`. **Esse campo não existe** em `x_comunidade` — só
apareceu ao revisar o dump do Odoo, depois do merge. Não quebrava nada (caía
no padrão), mas a afirmação estava errada.

**Decidido em 19/09 que o campo não será criado.** A cidade do recebedor no
campo 60 do BR Code serve para exibição, e o padrão resolve. A referência foi
removida do código para não apontar para um campo inexistente.

#### 📋 EXECUÇÃO 2026-09-19 07:01 UTC

**Concluídos:** A1 a A12 — **a TRILHA A inteira.** O A12 está feito na metade que a sonda S1 provou (quem já é dizimista); a de número novo espera a **S10**.

**O A9 foi adiantado** para junto do A6: subir o botão de Oferta sem destino deixaria um caminho morto em produção até a execução seguinte.

**Nada foi pulado por falta de decisão.**

**Três coisas que o harness pegou e valem a sua atenção:**

1. `devolucoesDoMes` estava stubada no harness, então o filtro por tipo não era exercitado. **Terceira vez** nesta sessão que um stub esconde justamente a lógica sob teste (antes: `criarDizimista`/BL-39 e `registrarDevolucao`/A3). Ficou um comentário no harness listando o que não pode ser stubado.
2. A oferta exibia o valor do OCR e gravava o valor escolhido — a pessoa leria "R$ 50,00" num registro de R$ 20,00. Corrigido: a mensagem mostra o que foi gravado.
3. `campoExiste` não bastava para a comunidade, porque ela **já existe** e só muda de readonly para gravável. Escrever antes da migração faria o Odoo recusar a gravação inteira e a devolução se perderia. Daí o `campoGravavel()` novo.

**PR:** #44, aberto e mergeado. As ferramentas do GitHub existiam nesta execução, ao contrário do previsto.

---

#### 📋 EXECUÇÃO 2026-09-19 08:01 UTC — **a fila automática acabou**

**Concluídos:** BL-14 (testes de regressão) e BL-36 parte 1 (lista de bloqueio).

**Confirmados já resolvidos, backlog desatualizado:** BL-12, BL-13, BL-15 e BL-22. A execução foi implementá-los e encontrou os quatro já feitos em ciclos anteriores, sem marcação. Verificado lendo o código.

**⏭️ Pulados, e por quê:**

| Item | Motivo |
|---|---|
| ~~**A12**~~ (BL-41) | ✅ feito em 19/09, depois da S1. Metade de número novo pendente em **S10** |
| **BL-34** | depende de dado de uso que não existe |
| **BL-36 parte 2** (bloqueio automático) | depende de meses de `listarSuspeitos()` com tráfego real. É decisão sobre dado, não código |
| **BL-17** (uid Odoo dedicado) | administração no Odoo |
| **BL-21 / BL-29** (resto) | acoplados: a saída é tirar o processamento do webhook, mudança de arquitetura que não cabe numa execução autônoma sem decisão sua |

**Nada mais na fila é implementável sem você.** O que resta depende de credencial de Odoo, de sonda no aparelho, ou de dado que ainda não foi coletado.

**Um achado que vale a leitura:** três vezes nesta madrugada um stub do harness escondeu justamente a lógica sob teste (`criarDizimista`/BL-39, `registrarDevolucao`/A3, `devolucoesDoMes`/A5). E ao adicionar os testes do BL-14, carregar o `VisionService` junto dos handlers fez o `const` dele sombrear o stub — o `ComprovanteHandler` passou a chamar a API de OCR de verdade e três cenários quebraram. O padrão é consistente o bastante para merecer atenção: **stub cômodo esconde o que importa testar.**

---

#### ✅ FECHADO — 19/09/2026, testado em produção

Migração do Odoo feita e conferida (5150 → 5150), campos criados, formulário publicado, deployment republicado, fluxo testado de ponta a ponta pelo usuário.

**Três correções que só apareceram no uso real, depois da trilha A:**

| O que | Como apareceu |
|---|---|
| `helper-text` não vale em `Dropdown` | recusa da Meta ao publicar. Virou **regra 5** do `valida-flow.js` |
| Comunidade pré-selecionada | o usuário reparou que induzia a erro. O código era pior: caía em `comunidades[0].id` para quem **não** era cadastrado — a primeira da lista, arbitrária, decidindo para onde ia o dinheiro. Virou **regra 6** |
| Nome de quem oferta | sem ele, a oferta chegava à secretaria como telefone solto |

**E um bug que não era do BL-41**, encontrado no Cloud Logging durante os testes: `Utils._mesAtual` era chamada em 4 lugares e nunca existiu (**BL-42**). Toda a medição de consumo — mensagens e cota de UrlFetch — nunca funcionou em produção, porque `registrarConsumoExterno` lançava na primeira linha do `try`. Três `catch` engoliam o erro.

**O que ficou aberto**, e não depende de código:

- ~~**S1**~~ ✅ 19/09 — respondida em 4 rodadas. **A12 implementado** para quem já é dizimista; a metade de número novo virou **S10**
- **S4** — custo do `order_status` (BL-40). **Só agora faz sentido medir**: antes do BL-42 o contador estava zerado
- ~~**S6**~~ ✅ 19/09 — resolvido sozinho: o webhook aprende o número do bot pelo `metadata` da Meta

---

#### As 12 chamadas do item A5

| Função | Pontos de chamada | O que quebra sem filtro |
|---|---|---|
| `devolucoesDoMes` | `DevolucaoHandler:78, 194` | Aviso de duplicata dispara errado: quem ofertou levaria "você já devolveu este mês" |
| `buscarDevolucoesDizimista` | `DevolucaoHandler:412, 469` | Histórico e a linha "última devolução" misturam oferta com dízimo |
| `listarDevolucoesPorPeriodo` | `RelatorioHandler:427, 432` · `TesteRelatorio:115, 290, 346` | **Relatório do coordenador soma oferta como dízimo** |
| `buscarDevolucoesPendentes` | `RelatorioHandler:789` | Fila de conferência mistura os dois |
| `buscarDevolucaoDetalhada` | `RelatorioHandler:866` | Tela de detalhe não diz o que é |
| `atualizarStatusDevolucao` | `RelatorioHandler:998, 1032` | Funciona, mas o log precisa registrar o tipo |

⚠️ O item do relatório é o mais grave da fila: número errado não falha, só mente.

#### Contagem esperada

| Jornada | Mensagens |
|---|---|
| Dízimo, cadastrado | 2 (não muda) |
| Oferta, cadastrado | 3 (formulário + card + resultado) |
| Oferta, anônimo | 3 (o formulário já traz a comunidade) |
| Contato Pastoral | 2 (submenu + cartão) |

**Aceite:** oferta registrada com comunidade e sem dizimista; relatórios separando os dois; nenhuma devolução gravando sem comunidade.

---

### BL-42 — `_mesAtual` chamada em 4 lugares e nunca definida 🔴 (P) — ✅ corrigido em 19/09/2026
**Encontrado pelo usuário no Cloud Logging**, com o bot já em produção: `this._mesAtual is not a function`, repetindo a cada 5 minutos (a trigger de sessões).

**O que estava quebrado, e há quanto tempo.** A função era chamada em `registrarConsumoExterno`, `somarMensagensDoMes` e duas vezes em `verificarCotaMensagens` — e nunca existiu. Consequências:

- **`registrarConsumoExterno` lançava na PRIMEIRA linha do `try`**, antes de gravar qualquer contador. Nem o consumo de mensagens nem a cota de UrlFetch (BL-25) chegaram a ser persistidos **uma única vez**.
- `verificarConsumoMensagens()` reportava zero, e o alerta de franquia nunca poderia disparar.

**Por que ficou invisível.** As três chamadas estão dentro de `try/catch` com `console.warn`. O bot funcionava normalmente; só a medição estava morta. O sintoma só apareceu porque a trigger roda de 5 em 5 minutos e encheu o log.

⚠️ **Consequência para as análises de custo desta sessão:** todo número de consumo citado a partir do contador do próprio bot era zero por este bug, não por baixo tráfego. As contas de `FLUXOS.md` continuam válidas — elas vêm de contar envios no código e no harness, não do contador —, mas **a medição real começa agora**.

**A guarda que faltava.** O harness passou a varrer, estaticamente, os 10 objetos de serviço: junta todo `this.x(` do fonte e confere se `x` existe. Não substitui teste de comportamento — pega a classe de erro que só aparece em runtime, dentro de um `catch` que ninguém lê. Verificado removendo a função de novo: a varredura acusa.

---

---

## Itens baixos / manutenção

### BL-12 — `ASSETS` não declarado 🟡 (P) — ✅ **já estava resolvido** (confirmado em 19/09)
O objeto `ASSETS` existe em `Assets.gs`, e `getAvatar()` degrada em silêncio enquanto o id começar com `COLE_AQUI` — em vez do `ReferenceError` original.

**Nota:** `getAvatar()` hoje só é chamado por `Tests.gs`. As boas-vindas usam o avatar do Odoo (`x_studio_avatar`), que é reaproveitado entre contatos pelo BL-21. Ou seja, a função é um caminho alternativo mantido para quem preferir hospedar o avatar no Drive. Não é código morto, mas também não está no caminho de produção — vale saber antes de mexer nela.

### BL-13 — Secretaria com placeholder 🟡 (P) — ✅ **já estava resolvido** (confirmado em 19/09)
Não há mais `(00) 0000-0000` nem `secretaria@exemplo.com` no projeto. `MenuHandler._enviarContatoGeral` lê `x_studio_secretaria_whatsapp` e `x_studio_secretaria_email` de `OdooService.buscarParametros()`, e omite a linha quando o parâmetro está vazio — em vez de exibir um telefone falso.

### BL-14 — Extração frágil de valor e chave PIX do OCR 🟠 (M) — *refinado por simulação*
`VisionService.gs:218-272`. Dois problemas confirmados na simulação real:
- **Valor:** `_extrairValor` retorna o primeiro `R$` encontrado, que pode ser tarifa/saldo, não o valor transferido.
- **Chave PIX:** `_extrairChavePix` retornou `4339441920260` — que **não é uma chave**, mas os 13 primeiros dígitos do *ID da transação* (`E**4339441920260**4052103uuGZ7BZQ3g5`). O padrão de telefone (primeiro do array) casa com o trecho numérico do ID antes de chegar à chave real (`160.740.093-68`). Isso grava dado enganoso no Odoo e inviabiliza o BL-26.
**Correção:** melhorar heurística de valor (proximidade de "valor"/"total"/"pix", maior valor, contexto) e de chave (ignorar sequências dentro do "ID da transação"/"identificador"; priorizar padrões ancorados por rótulo "Chave Pix:"; reordenar padrões para não deixar telefone capturar IDs). Elevada de 🟡 para 🟠 por bloquear a validação do BL-26.

✅ **Concluído em 19/09.** A heurística já havia sido refeita em ciclo anterior — o que faltava era **guarda**: a correção existia e nada impedia que uma mexida futura a desfizesse, em silêncio, do jeito que só aparece num comprovante real meses depois.

Seis casos entraram no harness, a partir do texto que de fato falhou:

| Caso | O que guarda |
|---|---|
| `E43394419202604052103uuGZ7BZQ3g5` + `160.740.093-68` | o ID da transação não vira chave |
| Tarifa R$ 2,50 · Valor R$ 80,00 | tarifa não vira valor pago |
| Saldo R$ 4.320,15 · Pix R$ 45,00 | saldo não vira valor pago |
| `tesouraria@paroquia.org.br` | e-mail com domínio multinível |
| UUID | chave aleatória |
| `+55 86 98852-1231` | telefone só conta com o `+55` |

**Nota do harness:** o `VisionService` é carregado num contexto próprio, só para os extratores. Junto dos handlers, o `const VisionService` sombrearia o stub e o `ComprovanteHandler` passaria a chamar a API de OCR de verdade — foi o que aconteceu ao tentar o atalho.

### BL-15 — Efeito colateral em busca 🟡 (P) — ✅ **já estava resolvido** (confirmado em 19/09)
A gravação saiu de `buscarDizimistaPorWhatsapp`. O comentário no código explica por que ela não pode voltar: `x_studio_partner_phone` é related e gravável, então um write ali propagaria para `res.partner.phone` — efeito colateral indevido numa função de leitura. A busca com e sem o nono dígito (BL-32) já encontra o registro sem precisar normalizar nada.

### BL-16 — Testes no deploy de produção 🟡 (M)
`Tests.gs` (~175 KB), `TestesComprovantes.gs` (~93 KB, com base64), `TesteRelatorio.gs` (~34 KB) somam a maior parte do que o clasp envia. Mover para um projeto GAS separado ou excluir do push.

**✅ Corrigido em 17/09/2026 via `.claspignore`.** Os arquivos seguem versionados no Git; apenas deixam de subir no `clasp push`.

**Projeto GAS separado foi descartado:** os testes chamam os globais de produção (`OdooService`, `Utils`, `StateManager`…), então um projeto à parte exigiria duplicar o código do bot dentro dele — dois lugares para manter a mesma coisa. Excluir do push resolve sem essa duplicação.

**Bloat extra encontrado, fora do escrito no item:** o `clasp` trata **qualquer `.html`** como arquivo do projeto, então as 5 páginas de `docs/` (~97 KB — política de privacidade, termo de uso, etc.) também estavam indo para o deploy. Elas são servidas pelo GitHub Pages (`docs/CNAME` → `meudizimo.pnscaparecida.com`) e não têm relação com o Apps Script: não há um único uso de `HtmlService` no projeto. Também excluídas.

| | Antes | Depois |
|---|---|---|
| Código de produção | ~281 KB | ~281 KB |
| Suíte de testes | ~320 KB | — |
| Site `docs/` | ~97 KB | — |
| **Total enviado** | **~699 KB** | **~281 KB** (−60%) |

**Duas armadilhas documentadas no próprio arquivo:**
1. A existência de um `.claspignore` **substitui** a lista padrão do clasp, então `.git/**` e `node_modules/**` precisaram ser repetidos.
2. `clasp push` sincroniza: o primeiro push após a mudança **apaga** os arquivos de teste do editor online. É o efeito desejado, mas convém saber antes.

**Para rodar a suíte:** comentar as quatro linhas da seção de testes no `.claspignore`, `clasp push`, executar no editor, descomentar e publicar de novo. O passo a passo está no cabeçalho do arquivo.

**Correção de arrasto:** `Setup.gs` mandava executar `testarOdooService()` e `testarMenuCompleto()` — **funções que não existem em lugar nenhum do projeto**, um erro anterior a esta mudança e que ficaria pior com os testes fora do deploy. As referências foram corrigidas e foi criada a função `testarConexaoOdoo()`, que faz uma leitura mínima em `x_comunidade` para validar URL, database, uid e API key. Ela vive em `Setup.gs` justamente para continuar disponível no projeto publicado.

### BL-17 — Endurecer segurança 🟠 (M) — *elevado de 🟡 em 17/09/2026*
Usuário Odoo dedicado (não uid 2/admin) com acesso restrito aos modelos `x_*`; tornar `WEBHOOK_SECRET` obrigatório após o setup (hoje o webhook aceita POST anônimo se o segredo não estiver configurado — `Webhook.gs:57-65`).

**✅ Metade 1 — `WEBHOOK_SECRET` obrigatório (17/09/2026).** `doPost` virou *fail-closed*: sem segredo configurado, rejeita. Antes, a ausência do segredo apenas logava um warning e o POST seguia — e como o deployment é `ANYONE_ANONYMOUS`, qualquer um que descobrisse a URL podia forjar payloads do WhatsApp e injetar cadastros e devoluções.

⚠️ **A troca exige ordem de operação, senão o bot fica mudo.** O Apps Script sempre responde 200 (não dá para devolver 403), então a Meta **não reenvia** o que for rejeitado: mensagens recebidas com o token errado são perdidas, não enfileiradas. Por isso foi criada **`configurarSegredoWebhook()`** (Setup.gs), que gera o segredo e imprime a URL de callback pronta. Sequência correta:
1. Rodar `configurarSegredoWebhook()` e copiar a URL do log.
2. Colar a URL na Meta (Callback URL) — **antes** do passo 3.
3. Republicar o deployment com o código novo.

**Roteiro da metade 2 (fazer no Odoo, ~15 min).** A API key **não pode** ser criada via API — o Odoo exige que o próprio usuário a gere logado na interface —, então não há como automatizar este item por completo:
1. **Criar o usuário.** Configurações → Usuários e Empresas → Usuários → Novo. Nome: `Bot Meu Dízimo`. Tipo de usuário: *Usuário interno*. Desmarque todos os grupos de aplicativos (Vendas, Contabilidade, etc.) — o bot não precisa de nenhum.
2. **Dar acesso só aos modelos do bot.** Com o modo desenvolvedor ativo: Configurações → Técnico → Segurança → Regras de Acesso (`ir.model.access`). Criar uma regra por modelo — `x_dizimista`, `x_devolucao`, `x_comunidade`, `x_contato_bot`, `x_parametros`, `x_parametros_line`, `x_notificacao_log` — vinculada a um grupo novo (ex.: `Bot / Operação`) com leitura e escrita/criação onde o bot grava. Sem acesso a `res.users`, `res.partner` além do necessário, nem a modelos contábeis.
3. **Gerar a API key.** Entrar no Odoo **como esse usuário** → Preferências → Segurança da Conta → Nova chave de API. Copiar o valor (só aparece uma vez).
4. **Descobrir o uid.** Com o modo desenvolvedor, abrir o usuário e ler o `id` na URL, ou rodar no bot: `OdooService.searchRead('res.users', ['id','login'], [['login','=','<login do bot>']], {limit:1})`.
5. **Atualizar as propriedades** `ODOO_UID` e `ODOO_API_KEY` e rodar **`testarConexaoOdoo()`**. Se a leitura de `x_comunidade` passar e o aviso de administrador sumir, está feito.

⚠️ Teste antes de considerar pronto: uma ACL faltando só aparece quando o fluxo correspondente roda. Vale exercitar cadastro, devolução com comprovante e relatório do coordenador com o novo uid — de preferência na mesma rodada de testes de staging.

**⚠️ Metade 2 — uid dedicado: NÃO resolvido em código.** Criar o usuário, restringir as permissões aos modelos `x_*` e gerar a API key é tarefa de administração dentro do Odoo — não dá para fazer pelo repositório, e mexer nisso em produção sem combinar seria arriscado. O que o código faz agora é **alertar**: `verificarProperties()` avisa quando `ODOO_UID = 2` e lista os quatro passos da migração. `Config.gs` mantém o fallback `|| 2` de propósito: removê-lo derrubaria as chamadas ao Odoo num ambiente onde a propriedade não esteja setada, sem fechar brecha alguma (o risco é *usar* admin, não o default).
**Aceite restante:** `ODOO_UID` apontando para um usuário sem direitos administrativos, com `testarOdooService()` passando.

---

## Análise de concorrência e carga

### Modelo de execução (fatos do projeto)
- **Deploy:** `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS` (`appsscript.json`). Consequência central: **todas** as execuções do webhook rodam como o **mesmo** usuário (o dono do deploy) e **compartilham um único pool** de execuções simultâneas e as mesmas cotas de projeto — não há isolamento por usuário do WhatsApp.
- **Estado:** `CacheService` por usuário (`estado_${from}`, `dados_${from}`) + uma chave **global** `sessoes_cadastro_ativas`. Persistência final em Odoo.
- **Trabalho por mensagem:** de 1 (texto simples) a ~6-8 chamadas externas (fluxo de comprovante: baixar mídia + Vision + buscar dizimista + criar devolução + envios WhatsApp), com ~7s de `Utilities.sleep` de UX.

### Cotas relevantes do Apps Script *(aproximadas — variam por tipo de conta e mudam com o tempo; confirmar no painel de cotas)*
| Recurso | Ordem de grandeza | Efeito ao estourar |
|---|---|---|
| Execuções simultâneas | ~30 (por usuário → aqui, global) | Excedentes falham ("too many simultaneous invocations") |
| Tempo por execução | 6 min | Execução abortada |
| `UrlFetch`/dia | ~20 mil (grátis) / ~100 mil (Workspace) | Bloqueio de chamadas externas no dia |
| Tempo total de trigger/dia | ~90 min (grátis) | Trigger para de rodar |

### Como a aplicação se comporta sob muitos acessos simultâneos

1. **Teto de ~30 execuções simultâneas (BL-21).** Como todas as mensagens compartilham o pool do dono do deploy, um pico acima de ~30 mensagens *no mesmo instante* faz os excedentes falharem no webhook → a Meta recebe não-200 e **reenvia** depois. Efeito prático: sob rajada, os usuários sentem **lentidão**, não perda (a Meta faz retry), mas há um ponto de saturação real.

2. **Race condition por usuário (BL-20) — o risco mais concreto.** Estado e dados temporários são lidos-modificados-gravados **sem lock** (`getDadosTemporarios` → altera → `setDadosTemporarios`, em `StateManager` e nos helpers `salvarMultiplosCampos`/`salvarCampoEMudarEstado`). Se o **mesmo** usuário emitir duas mensagens quase juntas (ou a Meta entregar um lote / retries concorrentes), duas execuções podem sobrescrever os dados uma da outra → **campo de cadastro perdido** ou estado inconsistente. A idempotência do webhook protege contra reprocessar a *mesma* messageId, mas **não** contra duas mensagens diferentes do mesmo usuário em paralelo.

3. **Gargalo do lock global (BL-22).** `registrarSessaoAtiva`/`removerSessaoAtiva` usam `LockService.getScriptLock()` (lock **global**, não por usuário) com `waitLock(5000)`. Sob muitos cadastros simultâneos, todos disputam o mesmo lock; alguns podem estourar os 5s e **não registrar/remover** a sessão (apenas warning). Impacto: sessões órfãs na lista ou não rastreadas para limpeza — degradação, não corrupção de dado do usuário.

4. **Duplicação em primeiro contato (BL-23).** Se um usuário novo manda 2 mensagens simultâneas, ambas as execuções podem não achar o `x_contato_bot`, **criar dois registros** e mandar boas-vindas em duplicidade (o cache anti-duplicação é gravado só depois).

5. **Odoo Online é o verdadeiro teto de escala.** Cada mensagem gera várias chamadas JSON-RPC (com uid 2). O Odoo SaaS tem workers limitados; uma rajada satura os workers → respostas lentas → execuções do GAS ficam mais longas → o pool de ~30 esgota mais rápido → mais retries da Meta → **efeito cascata (retry storm)**. É aqui que o sistema "cai de joelhos" antes de qualquer cota do Google.

6. **Cenário que dispara o pico:** o *disparo de lembretes mensais* (quando BL-01 for corrigido) envia para muitos de uma vez; boa parte responde nos minutos seguintes → rajada concentrada. Também: avisos de evento/campanha. No uso cotidiano de uma paróquia (mensagens esparsas), a simultaneidade real raramente passa de um punhado — então **no dia a dia o comportamento é adequado**; o risco mora nos picos concentrados.

7. **Sem retry/backoff (BL-24).** `Utils._post` loga falha de WhatsApp (429/janela 24h) mas não reenvia; Odoo/Vision idem. Sob throttling, mensagens são perdidas silenciosamente para o usuário (só ficam no log).

### Itens de backlog derivados

### BL-20 — Lock por usuário no estado/dados 🟠 (M) — ✅ concluído, com ressalva
Proteger o read-modify-write de `dados_${from}`/`estado_${from}` com `LockService.getScriptLock()` chaveado logicamente por usuário (ou serializar por `from`), evitando lost update quando o mesmo usuário envia mensagens concorrentes. Alternativa: usar `getUserLock()` — mas como o execute-as é único, avaliar um lock curto por chave. Aceite: duas mensagens quase simultâneas do mesmo usuário não corrompem os dados do cadastro.

**Auditoria 17/09/2026:** a cobertura está correta — os 25 pontos de escrita do código passam por `salvarCampoEMudarEstado`/`salvarMultiplosCampos`, e nenhum chama `setDadosTemporarios` direto. **Duas ressalvas:** (1) o `_comLock` é *best-effort* — se o lock não vier em 3s ele grava **sem** lock (`StateManager.gs:64-78`), então o lost update ainda é possível justamente sob a contenção que deveria proteger; (2) o Apps Script só oferece lock **global**. Com o BL-22 resolvido (17/09), a disputa diminuiu bastante — o índice de sessões saiu do lock —, mas este `_comLock` e o `ehPrimeiroContato` do BL-23 seguem serializando globalmente. Não há como torná-los por usuário: o `CacheService` não tem compare-and-swap e o `getUserLock()` é inútil aqui, já que o `executeAs` é único. A saída é o **BL-21**.

### BL-21 — Mitigar teto de execuções simultâneas 🟠 (G) — ⚠️ parcial
Reduzir o tempo de cada execução (retirar/reduzir `Utilities.sleep`, adiar trabalho pesado). Avaliar responder 200 à Meta **imediatamente** e processar de forma assíncrona (fila via `CacheService`/planilha + trigger), desacoplando o ACK do webhook do processamento. Aceite: um pico de N mensagens não derruba o webhook; latência estável.

#### A fila assíncrona foi avaliada e descartada (17/09/2026)

A proposta esbarra em três limites do Apps Script que a tornam pior que o problema que resolve:

1. **Trigger tem intervalo mínimo de 1 minuto.** Uma fila drenada por trigger agendada adicionaria **até 60 s de espera antes de qualquer resposta** do bot. Para uma conversa no WhatsApp isso não é latência, é a sensação de que o bot morreu.
2. **Trigger pontual não escala.** `ScriptApp.newTrigger().timeBased().after(ms)` pareceria resolver, mas o Apps Script limita a **20 triggers por script**: uma trigger por mensagem estoura o teto num pico — exatamente o cenário que o item quer proteger.
3. **A fila precisaria ser durável.** `CacheService` pode despejar entradas sob pressão, e perder uma entrada aqui significa **perder uma devolução já confirmada ao usuário**. Planilha é durável, mas lenta e com escrita concorrente que exigiria `LockService` — reintroduzindo a contenção global recém-eliminada no BL-22.

Ou seja: a fila trocaria uma saturação rara (a própria análise de carga deste documento nota que "no uso cotidiano de uma paróquia a simultaneidade real raramente passa de um punhado") por uma penalidade de experiência constante e um risco novo de perda de dado financeiro. **Decisão: não implementar.**

#### O que foi feito: redução do tempo de execução

O teto de ~30 execuções simultâneas é consumido por *execuções em voo*, então encurtar cada execução aumenta a vazão efetiva na mesma proporção. Foram removidas **4 esperas que não ordenavam nada** (≈6 s no total):

| Local | Espera | Por que era inócua |
|---|---|---|
| `ComprovanteHandler` | 2 s | Seguida das chamadas ao Odoo (buscar dizimista, buscar comunidade, criar devolução com base64), que já separam as mensagens de sobra — **no fluxo mais pesado do bot** |
| `CadastroHandler.iniciar` | 2 s | Não havia mensagem anterior para ordenar; a busca no Odoo já é a pausa natural |
| `DevolucaoHandler` (histórico vazio) | 1 s | A consulta ao Odoo já separa do "Buscando histórico..." |
| `MenuHandler.boasVindas` | 1 s | Esperava por uma chamada **comentada** (`//this.menuPrincipal`) — não guardava absolutamente nada |

**O que foi deliberadamente mantido:** as ~11 esperas do tipo `envia → espera → envia`. Elas existem para garantir a ordem de chegada das mensagens no WhatsApp, que não é garantida em POSTs consecutivos rápidos. Removê-las embaralharia a conversa (ex.: a pergunta seguinte chegando antes do "✅ registrado"), e isso não é testável sem exercitar o bot de verdade. Também ficaram as esperas de propagação de mídia no `MediaService` (3 s/2 s entre upload e envio), que são funcionais, não cosméticas.

**⚠️ Ganhou um segundo motivo (17/09, ver BL-29):** a duração da execução não afeta só a vazão — ela define a **janela em que mensagens do mesmo usuário se atropelam** e acabam gravadas no campo errado. Com execuções medidas em 10-24 s, mensagens separadas por dezenas de segundos ainda colidem. Encurtar a execução estreita esse bug diretamente.

**Ganho real e honesto:** ~2 s a menos por comprovante e ~1-2 s nos demais fluxos citados. Isso **alivia**, não resolve: o gargalo dominante do fluxo de comprovante são as chamadas externas (download da mídia, OCR, e o `create` no Odoo com o anexo em base64), não as pausas. Sob um pico concentrado de verdade — o disparo mensal do BL-01 é o cenário — o teto continua existindo.

**Se um dia o volume justificar**, o caminho não é a fila por trigger: é reduzir o trabalho por mensagem (ex.: não trafegar o comprovante em base64 dentro do `create`, ou adiar o anexo para uma segunda etapa) ou sair do Apps Script para um runtime sem teto de execuções simultâneas. Ambos são mudanças de arquitetura que merecem decisão própria, não um item de backlog.

### BL-22 — Reduzir contenção do lock global 🟠 (M) — *elevado de 🟡 em 17/09/2026*
Repensar `sessoes_cadastro_ativas`: em vez de uma lista única sob lock global, usar chaves por usuário (`sessao_ativa_${from}`) e varrer por prefixo na trigger, ou aceitar perda eventual sem lock. Aceite: cadastros simultâneos não competem por um lock único.

**Por que subiu de severidade:** quando este item foi escrito, o lock global era disputado apenas por `registrarSessaoAtiva`/`removerSessaoAtiva` (`waitLock(5000)`). A correção do BL-20 passou a tomar **o mesmo lock global** (`waitLock(3000)`) em *toda* gravação de campo do cadastro — ou seja, fechar o BL-20 aumentou a contenção exatamente no gargalo descrito aqui. A correção do BL-23 (17/09) somou um terceiro consumidor.

**✅ Corrigido em 17/09/2026 — o índice de sessões não usa mais lock nenhum.** Cada sessão virou uma propriedade própria (`sessao_ativa_<numero>`, valor = timestamp de início) em vez de um array JSON numa chave única. Como cada execução escreve apenas a **sua** chave, o read-modify-write compartilhado deixou de existir e o lock ficou desnecessário — não é o lock que foi afrouxado, é a disputa que sumiu.

**Por que PropertiesService e não CacheService:** a sugestão original deste item era "usar chaves por usuário e varrer por prefixo na trigger" — mas isso **não é possível no CacheService**, que não lista chaves (só lê por chave conhecida, via `get`/`getAll`). A trigger precisa enumerar as sessões, e só `PropertiesService.getProperties()` devolve tudo. As propriedades de sessão convivem com as de configuração no mesmo store, separadas pelo prefixo; `setupProperties()` usa `setProperties(obj)` de um argumento só, que mescla em vez de apagar as demais, então não há conflito.

**Custo aceito:** propriedades não têm TTL, ao contrário do cache. A limpeza vem da própria trigger — toda entrada do índice ou tem sessão viva (tratada pelas regras de tempo e removida aos 60 min) ou não tem cache (persistida e limpa na hora), então nada sobrevive mais que uma rodada de 5 min. Se a trigger for desinstalada, aí sim as entradas acumulam; são ~40 bytes cada, longe da cota de 500 KB, e uma trigger parada já é um problema maior por si só.

**Transitório no deploy:** as sessões que estiverem na lista antiga do cache no momento da publicação ficam órfãs — no máximo alguns usuários em cadastro perdem o aviso de 50 min e o registro da etapa de abandono. Os dados deles expiram normalmente pelo TTL. Não escrevi migração para um estado transitório de uma rodada.

**Testado localmente** (8 asserções, com `PropertiesService` stubado): listagem devolve só os números e nunca as chaves de configuração; número recuperado íntegro (o `slice` do prefixo não corta dígito); valor gravado é timestamp; remoção afeta só a sessão pedida; configuração intacta depois de registrar/remover; remover número inexistente não quebra; registrar o mesmo número duas vezes mantém uma entrada.

**O lock global continua existindo para outros dois usos**, que não são deste item: o `_comLock` do BL-20 (gravação de campo do cadastro) e o `ehPrimeiroContato` do BL-23. Ambos protegem read-modify-write em `CacheService`, que não tem compare-and-swap, e `LockService.getUserLock()` não ajuda porque o `executeAs` é único — todas as execuções são o mesmo usuário. Eliminá-los de vez exige o **BL-21** (tirar o processamento do webhook). Os dois itens estão acoplados e devem ser tratados juntos: a saída real é eliminar a lista global (chaves por usuário) e/ou mover o processamento para fora do webhook (BL-21), o que também dispensaria o lock do BL-20.

### BL-23 — Idempotência do primeiro contato 🟡 (P)
Tornar `ehPrimeiroContato`/`registrarContatoBot` idempotente (checar/gravar cache antes da chamada Odoo, ou usar unicidade em `x_name` no Odoo). Aceite: duas mensagens simultâneas de número novo criam **um** `x_contato_bot` e uma boas-vindas.

**✅ Corrigido em 17/09/2026.** `ehPrimeiroContato` passou a serializar o read-modify-write (buscar → criar → cachear) com `LockService`, com **dupla checagem do cache dentro do lock** — outra execução pode ter registrado o contato enquanto esperávamos. O lock só é disputado no *cache miss* (contato novo ou cache expirado em 6 h); o caminho normal, com cache hit, continua sem lock e sem chamada ao Odoo.
**Impacto extra que o item não mencionava:** o registro duplicado não causava só duas boas-vindas. `atualizarContatoBot` faz buscar → write e escreve **no primeiro registro que encontra**, então, com duplicatas, o log de cadastro e a etapa de abandono passavam a cair num registro arbitrário dos dois.
**Decisão de projeto:** se o lock não for obtido em 5 s, a função retorna `false` (pula a boas-vindas) em vez de seguir sem lock — duplicar o registro é pior que atrasar a saudação, e a próxima mensagem do usuário refaz a verificação. É o oposto da escolha feita no `_comLock` do BL-20, onde perder o dado do cadastro seria pior que gravar sem lock.
**Custo:** é o mesmo lock global usado pelo `_comLock` do BL-20, e aqui ele é mantido durante chamadas de rede ao Odoo (~1-2 s no pior caso), não só durante escrita em cache. **Interação com o BL-24:** desde que as chamadas ao Odoo ganharam retry, o pior caso cresceu — sob throttling, o lock pode ficar retido por mais ~3 s de backoff (1 s + 2 s). Continua sendo degradação e só no cache miss do primeiro contato, mas é um efeito que não existia quando este item foi escrito. Só acontece em cache miss, mas é hoje — junto com o BL-20 — um dos dois usos restantes do lock global, e eliminá-los exige o BL-21.

### BL-24 — Retry/backoff em chamadas externas 🟡 (M)
Adicionar reenvio com backoff para 429/5xx em `Utils._post` (WhatsApp) e nas chamadas Odoo/Vision, com limite de tentativas. Aceite: um 429 transitório não perde a mensagem ao usuário.

**✅ Corrigido em 17/09/2026.** Helper único `Utils.fetchComRetry(url, options, { idempotente, rotulo })`: no máximo 3 tentativas, backoff exponencial de 1 s e 2 s.

**A decisão central é *quando não* repetir.** Reenviar cegamente um 5xx é perigoso: o servidor pode ter processado a requisição antes de falhar, e repetir um `create` no Odoo gravaria **a mesma devolução duas vezes** — exatamente a classe de bug do BL-23, com dado financeiro. A política é:
| Situação | Repete? | Por quê |
|---|---|---|
| **429** (throttling) | Sempre | A requisição foi recusada *antes* de executar; repetir nunca duplica |
| **5xx / exceção de rede**, chamada idempotente | Sim | `search_read`, `search_count`, `write`, OCR e downloads podem repetir sem efeito colateral |
| **5xx / exceção de rede**, chamada não idempotente | **Não** | `create` no Odoo e envio de mensagem ao WhatsApp — repetir duplicaria registro ou mensagem |

No Odoo a política é derivada do próprio payload (`args[4] !== 'create'`), sem mudar assinatura de método. Aplicado em: `Utils._post` (WhatsApp), `OdooService._rpc`, `VisionService` (imagem e PDF) e os dois GETs de `MediaService.baixarArquivo` — este último não estava no escopo original do item, mas falhar ali significa perder o comprovante que o usuário acabou de enviar.

**Correção de bônus:** `_rpc` parseava o corpo como JSON sem olhar o status. Um 5xx do Odoo devolve HTML e estourava um `SyntaxError` de JSON, escondendo a causa real; agora vira um erro explícito com o código HTTP.

**Testado localmente** (8 cenários, fora do Apps Script, com `UrlFetchApp`/`Utilities` stubados): 200 direto; 429→200 em chamada não idempotente; 500 não idempotente **não** repetindo; 500 idempotente esgotando as 3 tentativas com backoff 1 s/2 s; exceção de rede nos dois modos; 429 permanente devolvendo a resposta sem lançar; 503→200 recuperando.

**Limite conhecido:** as esperas consomem o orçamento de 6 min por execução, por isso o teto é baixo (2 reenvios). Sob throttling sustentado isto ameniza, não resolve — a saída estrutural continua sendo o BL-21 (processar fora do webhook).

### BL-25 — Monitorar cota de UrlFetch 🟡 (P)
Instrumentar contagem diária de chamadas externas e alertar ao aproximar da cota; documentar o teto conforme o tipo de conta. Aceite: visibilidade do consumo diário antes de estourar.

**✅ Corrigido em 17/09/2026.** `Utils` passou a contar cada requisição real (tentativas de retry incluídas, pois consomem cota) num contador **da execução** — cada execução do Apps Script roda num contexto JS próprio, então ele zera sozinho. Ao fim de cada execução, `registrarConsumoExterno()` soma esse total ao dia corrente: **uma escrita em Properties por execução, não por chamada**, para não devolver ao custo de execução o que o BL-21 tirou. Ligado em três pontos: `doPost` (webhook), `executarNotificacoesDiarias` (o maior consumidor) e a trigger de sessões — nos dois últimos via `finally`, porque ambos têm `return` antecipado.

`verificarCotaUrlFetch()` roda de carona na trigger de sessões, que já executa a cada 5 min: soma os shards do dia, alerta (`log` → `warn` em 60% → `error` em 80%) e poda contadores com mais de 7 dias. O teto fica em `Utils.URLFETCH_COTA_DIARIA` (20 mil, conta gratuita; ~100 mil em Workspace — confirmar no painel de cotas).

**Precisão assumida:** o contador é distribuído em 5 shards escolhidos ao acaso para reduzir colisão, mas **não é exato** — sem compare-and-swap, duas execuções que leiam o mesmo shard ao mesmo tempo perdem um incremento. É uma subestimativa, por isso os alertas disparam em 60%/80%, com folga. Serve para dar ordem de grandeza, não para auditoria. Usar lock aqui reintroduziria exatamente a contenção removida no BL-22.

**Efeito colateral positivo:** para a contagem ficar correta, os 5 pontos de `UrlFetchApp` que ainda estavam fora do `fetchComRetry` (uploads de mídia, envio de mídia, QR Code e info de mídia) passaram a usá-lo. Além de serem contados, ganharam o retry do BL-24 com a política de idempotência correta — GETs como idempotentes, uploads e envios apenas em 429.

**Testado localmente** (11 asserções): contagem por execução, gravação no shard do dia, zeragem após registrar, execução sem chamadas não escrevendo, soma só do dia corrente, poda de dias antigos, configuração intacta e os três níveis de alerta.

**Contexto de capacidade (auditoria 17/09/2026) — vazão do disparo de notificações.** O envio é sequencial com `sleep(2000)` entre mensagens e o teto de execução é 6 min → **~180 mensagens por rodada**, e a consulta de elegíveis usa `{ limit: false }` (`NotificacaoHandler.gs:222,505`), sem teto. A repescagem horária recupera o que sobrou, mas em paróquia grande isso significa várias rodadas de ~6 min por dia; com ~12 rodadas na janela útil (8h–20h) chega-se perto da cota de **~90 min/dia de trigger** em conta gratuita. Vale medir o nº de elegíveis e o tempo por rodada antes do próximo ciclo, e considerar paginar o disparo explicitamente em vez de depender do corte por timeout.

---

## Auditoria de 17/09/2026

Revisão do código-fonte conferindo **cada item marcado como concluído** contra os arquivos `.gs`, em vez de confiar no status declarado.

### Confirmados como realmente concluídos
| Item | Evidência no código |
|---|---|
| BL-02 | `ComprovanteHandler._tratarResultado` trata três desfechos distintos; a confirmação de sucesso só sai com `devolucaoId` real |
| BL-03 | Aviso em 50 min (`StateManager.gs:211`) e expiração em 60 — textos, TTLs e trigger alinhados |
| BL-09 | Loop `entry[] → changes[] → messages[]` com idempotência gravada **antes** do processamento (`Webhook.gs:71-90,120-127`); falha de uma mensagem não derruba o lote |
| BL-14 | Valor ancorado por rótulo com fallback para o maior valor ignorando saldo/tarifa; chave PIX pula linhas de "ID da transação" e usa fronteiras `(?<!\d)`. Runtime é **V8** (`appsscript.json`), então os lookbehinds são suportados |
| BL-20 | Cobertura completa: os 25 pontos de escrita passam pelos helpers com lock (ver ressalvas no item) |

### Divergências encontradas
1. **BL-26 estava marcado ✅ mas cumpre o aceite só em parte** → reclassificado para ⚠️ Parcial. A conferência de chave existe e a mensagem ao usuário é honesta, mas não há campo estruturado: `x_studio_status` é `'Pendente'` para todos os casos e a marca de divergência vive num sufixo de texto do `x_name`.
2. **BL-27 (novo, 🔴)** — o fallback de PDF força `ehComprovante: true` e registra devolução de R$ 0,00 para qualquer PDF ilegível, contornando na prática a proteção do BL-26.
3. **BL-01 foi para produção fora da ordem planejada** — o Sprint 3 mandava fazer BL-21/BL-24 antes; o trigger está ativo e esses dois seguem abertos.
4. **BL-22 subiu de 🟡 para 🟠** — a correção do BL-20 passou a usar o mesmo lock global, agravando o gargalo que o BL-22 descreve.

### Itens abertos cuja permanência foi confirmada no código
*Situação no fim do dia 17/09: BL-16, BL-23 e BL-24 corrigidos; BL-17 com a metade do webhook fechada, restando o uid dedicado no Odoo.*
- **BL-16:** `Tests.gs` (175 KB), `TestesComprovantes.gs` (93 KB), `TesteRelatorio.gs` (33 KB) e `TesteNotificacao.gs` (19 KB) somam **~320 KB** ainda na raiz do projeto, indo junto no `clasp push`.
- **BL-17:** sem `WEBHOOK_SECRET`, o POST anônimo continua aceito com apenas um `console.warn` (`Webhook.gs:62-65`). Combinado com `access: ANYONE_ANONYMOUS`, qualquer um que descubra a URL injeta mensagens no fluxo.
- **BL-23:** a corrida está exatamente como descrita — `ehPrimeiroContato` faz cache miss → busca no Odoo → cria → e só **depois** grava o cache (`StateManager.gs:272-300`).
- **BL-24:** nenhum dos ~15 pontos de `UrlFetchApp` (Utils, OdooService, VisionService, MediaService) tem retry ou backoff.

---

## Sugestão de ordem de execução

*Revisada em 17/09/2026 — os Sprints 1 e 2 estão concluídos; a ordem abaixo reflete o que sobrou mais os achados da auditoria.*

1. ~~**Sprint 1 (integridade da devolução):** BL-02 → BL-14 → BL-26 → BL-04 → BL-03.~~ ✅ concluído (BL-26 parcial, ver Sprint 4).
2. ~~**Sprint 2 (médios):** BL-05, BL-06, BL-07, BL-08, BL-20, BL-10.~~ ✅ concluído.
3. **Sprint 3 (robustez/carga) — parcialmente feito:** BL-01, BL-09 e BL-11 concluídos. **Restam BL-21, BL-24 e BL-22** — e, como o BL-01 já está no ar, o BL-24 passou a ser o mais urgente do grupo.
4. **Sprint 4 (fechar a integridade do comprovante — prioridade atual):**
   ~~**BL-27**~~ ✅ → ~~**reforço do BL-26**~~ ✅ (falta rodar `criarCampoConferenciaPix()` no Odoo) → ~~**BL-17**~~ ⚠️ metade feita (webhook fail-closed; falta o uid dedicado no Odoo) → ~~**BL-23**~~ ✅. **Sprint 4 encerrado em código.**
5. **Sprint 5 (carga):** ~~BL-24~~ ✅ → ~~**BL-22**~~ ✅ → **BL-21** ⚠️ parcial — tempo de execução reduzido; a fila assíncrona foi avaliada e descartada por não caber nos limites do Apps Script (ver análise no item). O teto de execuções simultâneas e os dois usos restantes do lock global (BL-20, BL-23) seguem de pé, e sair deles exigiria mudança de arquitetura, não mais um item de backlog.
6. **Contínuo:** BL-12, BL-13, BL-15, BL-16, BL-25 ✅ — todos fechados.

---

## Checklist de publicação (17/09/2026)

Nada do que foi corrigido vale no bot antes destes passos. Ordem sugerida, tudo em ambiente de teste primeiro:

1. `clasp push` — o primeiro push **remove os arquivos de teste do editor online** (efeito esperado do BL-16).
2. Republicar o deployment (Implantar → Gerenciar implantações → nova versão). Sem isto, a URL do webhook continua servindo o código antigo.
3. No editor, rodar **`criarCampoConferenciaPix()`** — sem o campo, o BL-26 degrada para o comportamento anterior, sem o alerta ao coordenador. Leva até 5 min para passar a ser usado (cache da checagem de schema).
4. Rodar **`verificarProperties()`** e **`testarConexaoOdoo()`**.
5. `WEBHOOK_SECRET` já está configurado nesta instalação, então o fail-closed do BL-17 não muda nada na Meta. Para conferir a URL de callback: `configurarSegredoWebhook()` reimprime sem trocar o segredo.
6. Testar pelo WhatsApp, com atenção ao **fluxo de comprovante**, que concentra BL-24, BL-26 e BL-27: imagem legível, imagem com chave divergente (deve cair em conferência e aparecer com ⚠️ na lista do coordenador) e um PDF ilegível (deve pedir reenvio e **não** registrar R$ 0,00).
7. Opcional, quando quiser fechar o BL-17: seguir o roteiro do uid dedicado e repetir o passo 6 com as novas credenciais.
