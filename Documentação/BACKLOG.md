# Backlog — Bot Meu Dízimo (meu-dizimo-aparecida)✅ Concluído (24/09) — o caminho segue o ESTADO da conversa, não a sobra da sessão. **Precisa de `clasp push`** |✅ Concluído (24/09) — TTL de 6 h. A corrida simultânea fica para a Fase 3 do BL-74. **Precisa de `clasp push`** |✅ Concluído (24/09) — reação ignorada; demais tipos recebem aviso sem mexer no estado. **Precisa de `clasp push`** |✅ Concluído (24/09) — log registra tamanho e estado, não o texto. **Precisa de `clasp push`** |✅ Concluído (24/09) — id no botão; relê status e comunidade antes de gravar. **Precisa de `clasp push`** |✅ Concluído (24/09) — sem rótulo, "R$ 1500,00" nem era lido. **Precisa de `clasp push`** |✅ Concluído (24/09) — gravado em UTC. **Precisa de `clasp push`** |

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
| BL-43 | O arnês de testes só roda quando o Claude está no meio do caminho | 🟡 | P | ✅ **Concluído (24/09)** — CI em todo PR pela Fase 0 do BL-74 |
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
| BL-54 | Endereço e mapa da comunidade | 🟡 | M | ✅ **Instalado** (21/09) — campos e view de mapa no ar. Os endereços das 6 comunidades seguem por preencher |
| BL-55 | Sete dos oito formulários do Odoo nunca foram revisados | 🟡 | M | 📋 Aberto — só `x_devolucao.form` foi. Quatro têm coluna direita vazia |
| BL-56 | Classificação do dizimista era campo manual que ninguém mantinha | 🟠 | M | ✅ **Instalado** (21/09) — ação agendada diária, código versionado no repo |
| BL-57 | O agrupamento "Mês Referencia" agrupa por um campo que o bot nunca grava | 🟡 | P | 📋 Aberto — `x_studio_competencia` só é lido, nunca escrito; todo registro do WhatsApp cai num balde "Nenhum" |
| BL-58 | O mapa de dizimista continua vazio: o campo que ele lê não está no formulário | 🟡 | P | 📋 Aberto — precisa antes saber se `x_studio_partner_phone` é relacionado através de `x_studio_partner_id` |
| BL-59 | Classificação feita à mão é desfeita pela ação agendada na madrugada seguinte | 🟡 | P | 📋 Aberto — o statusbar virou só-leitura (21/09) para o problema não ser silencioso |
| BL-60 | O coordenador não tinha onde registrar a conferência dele, separada da do bot | 🟠 | M | ✅ **Instalado (22/09)** — campo, barra clicável, coluna e filtros |
| BL-61 | O banner de conferência mostra o código cru (`ausente`, `sem_referencia`) | 🟡 | P | ✅ Concluído (22/09) — tradução nas views; o tipo do campo **não pode** mudar, e está explicado |
| BL-62 | O ciclo de vida da devolução: A devolver → Em conferência → Conferido / Não confere | 🟠 | G | ✅ **Concluído (22/09)** — Odoo instalado, bot pronto, pergunta da competência incluída. **Precisa de `clasp push`** |
| BL-63 | O cadastro da comunidade pedia a imagem do QR Code, que o bot nunca leu | 🟡 | P | ✅ Concluído (21/09) — saiu da tela; o campo e as imagens continuam no Odoo |
| BL-64 | Validar exigia abrir o registro; no kanban não dava | 🟠 | M | ✅ **Instalado (22/09)** — ações 234 e 235, botões no card e no formulário |
| BL-65 | O calendário de dizimista apontava para a data de NASCIMENTO e nunca mostrou ninguém | 🟠 | M | ✅ **Instalado e conferido na tela** (22/09) — cores e filtro por comunidade funcionando |
| BL-66 | Não havia relatório mensal: o pivô abria num número só e o gráfico agrupava por campo vazio | 🟠 | P | ✅ Concluído (22/09) — mês × tipo, com valor, quantidade e pessoas. Só view, um `--update` |
| BL-67 | O `--download` apagou duas views editadas aqui e ainda não subidas | 🔴 | P | ✅ Concluído (22/09) — trava simétrica à do `--update`; as duas views restauradas |
| BL-68 | "Leitura automática do comprovante" aparecia em lançamento sem comprovante | 🟡 | P | ✅ Concluído (22/09) — o rótulo muda quando não há comprovante |
| BL-69 | Comprovante de qualquer idade registrava normalmente — não havia checagem de data | 🟠 | P | ✅ Concluído (23/09) — mais de 60 dias, ou data no futuro, vira "Não confere" e avisa a pessoa. **Precisa de `clasp push`** |
| BL-70 | Quem pula um mês tinha o dízimo gravado calado, sem escolher a competência | 🟠 | M | ✅ Concluído (23/09) — a pergunta passou a ser por intervalo desde a última devolução paga. **Precisa de `clasp push`** |
| BL-71 | O ciclo automático do mês seguinte complicava mais do que resolvia | 🟠 | M | ✅ Concluído (23/09) — **removido**. Sobrou a regra de ouro: mês anterior vazio, pergunta duas opções. **Precisa de `clasp push`** |
| BL-72 | Lote de um membro gravava o valor escolhido, não o do comprovante | 🟠 | P | ✅ Concluído (23/09) — comprovante de R$ 400 virava registro de R$ 100. **Precisa de `clasp push`** |
| BL-73 | O disparo de lembretes mandava TODO o lote de uma vez, sem teto | 🟠 | M | ✅ Concluído (23/09) — escalonado: janela, intervalo e tamanho do lote em `x_parametros`. **Precisa de `clasp push`** e do instalador |
| BL-74 | Sair do Apps Script: fila, estado em Redis, CI e monitoramento | 🟠 | GG | 🔶 **Corte executado (25/09)** — o bot roda só no Cloud Run; devolução com comprovante e primeiro lembrete provados na nuvem. Observação até 02/10 (Apps Script de pé como volta); depois Fase 6. Plano em `MIGRACAO-NIVEL-1.md` |
| BL-75 | Passou de 50 propriedades e a tela de configuração virou somente leitura | 🔴 | P | ✅ Concluído (24/09) — **bloqueava o BL-17**. Retenção cabia em ~120 props para servir 15. **Precisa de `clasp push`** e de rodar `podarContadores()` |
| BL-76 | Parâmetros, notificações e contato do bot visíveis a todo usuário interno | 🟡 | P | 📋 **Decidido, adiado (24/09)** — restringir ao perfil Administrador. É privilégio de PESSOA, não do bot |
| BL-17 | O bot falava com o Odoo como **Administrador** | 🔴 | M | ✅ **Concluído (24/09)** — `uid 13`, sem poder de administrador, permissões iguais à matriz. Conferido pelo `--verificar` contra o Odoo real. Nove notas de correção do próprio verificador |
| BL-77 | Dízimo gravado como oferta por campo de oferta que sobra na sessão | 🔴 | P | ✅ Concluído (24/09) — o caminho segue o ESTADO da conversa, não a sobra da sessão. **Publicado em 24/09** — validado no WhatsApp (oferta → menu → dízimo da família). |
| BL-78 | Deduplicação do webhook vale 10 min e não é atômica — reentrega duplica devolução | 🔴 | P | ✅ Concluído (24/09) — TTL de 6 h. A corrida simultânea fica para a Fase 3 do BL-74. **Publicado em 24/09** — publicado. |
| BL-79 | Reação, figurinha ou áudio zeram a conversa em andamento | 🟠 | P | ✅ Concluído (24/09) — reação ignorada; demais tipos recebem aviso sem mexer no estado. **Publicado em 24/09** — validado no WhatsApp (reação e áudio). |
| BL-80 | O código de acesso ao relatório (e dados do cadastro) vão para o log | 🟠 | P | ✅ Concluído (24/09) — log registra tamanho e estado, não o texto. **Publicado em 24/09** — publicado. |
| BL-81 | Confirmar/rejeitar baixa age sobre a ÚLTIMA pendente aberta, não a da mensagem | 🟠 | M | ✅ Concluído (24/09) — id no botão; relê status e comunidade antes de gravar. **Publicado em 24/09** — publicado — **falta validar** com acesso de coordenador. |
| BL-82 | OCR corta valor sem separador de milhar ("R$ 1234,56" → 123) | 🟠 | P | ✅ Concluído (24/09) — sem rótulo, "R$ 1500,00" nem era lido. **Publicado em 24/09** — publicado. |
| BL-83 | Primeiro contato gravado em hora local num campo `datetime` (3 h a menos na tela) | 🟡 | P | ✅ Concluído (24/09) — gravado em UTC. **Publicado em 24/09** — publicado. |
| BL-84 | Achados da revisão de 24/09 conferidos e corrigidos (15 itens) | 🟠 | G | ✅ Concluído (24/09) — todos confirmados; 14 corrigidos, 1 adiado para a Fase 3 do BL-74 (trava global). **Publicado e testado em 24/09** |
| BL-85 | Texto enviado enquanto o bot espera o comprovante desfazia a devolução | 🟠 | P | ✅ Concluído (24/09) — achado no teste real do BL-79. **Publicado em 24/09** — validado no WhatsApp. |
| BL-86 | Comprovante antigo recebe a frase "os dados de quem recebeu não batem" | 🟡 | P | 📋 Aberto (25/09) — achado no teste do corte: a data reprovou, mas a frase acusa nome/chave, que conferiam |
| BL-87 | Campo inteiro vazio do Odoo chega como 0 — hora inicial 0 abre a janela à meia-noite | 🟠 | P | ⚠️ Contido (26/09) — valores 9/17/2/20 gravados nos Parâmetros; o código ainda aceita o 0 |
| BL-88 | Os campos de lembrete e de idade do comprovante não estavam no Odoo nem na tela | 🟡 | P | ✅ Concluído (26/09) — campos criados, formulário de Parâmetros reorganizado, menu abre direto o registro |

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

**Sobre o botão pedido, e como ele acabou existindo:** na primeira volta o formulário ficou
só com a barra de status, porque botão de header chama uma `ir.actions.server` por **ID
numérico** e esse ID só nasce no `--aplicar` — não havia como versioná-lo antes de existir.
Depois que o `instalar-botoes-kanban.mjs` criou as ações **234** e **235**, os números
passaram a ser conhecidos, e os botões entraram no formulário direto no arquivo, sem
instalador.

A barra continua clicável ao lado deles de propósito: os botões só andam para a frente, e é
a barra que permite voltar para `A validar` depois de um clique errado.

**Risco que isso cria, e como está coberto:** os ids vivem em dois arquivos. Se alguém
recriar as ações, os números mudam e um botão passa a apontar para o nada — sem aviso; ele
aparece, é clicado, e o Odoo responde com erro na cara de quem usa. O `conta-mensagens.js`
confere que formulário e kanban citam **os mesmos ids**, então a divergência aparece na
verificação antes de aparecer na tela.

**Quem validou e quando:** o campo nasce com `tracking` e `x_devolucao` tem chatter, então
cada mudança vira uma linha no histórico do registro, com autor e horário. Dois campos a
menos para manter, e um histórico em vez de um instante.

**Aberto neste item:** nada impede um coordenador de validar devolução de outra
comunidade. Resolver isso é uma *record rule* ligada a `x_studio_coordenador`, e depende
de esse campo ser um `res.users` — o que ainda não foi verificado (mesma pendência do
BL-58).

---

### BL-61 — O código cru da conferência na tela ✅ (P)

O coordenador via `tudo_divergente`, `sem_referencia`, `ausente` — no banner do formulário,
no card do kanban e numa coluna da lista.

**O caminho certo não existe aqui.** `x_studio_conferencia_pix` é um campo **char**
(`SetupCamposFamilia.gs:66-68`): o valor gravado *é* o que aparece, e não há rótulo de
seleção para humanizar. Converter para `selection` seria a correção de verdade, e o Odoo
recusa:

> Changing the type of a field is not yet supported. Please drop it and create it again!
> — `odoo/addons/base/models/ir_model.py:1152`

Dropar para recriar apagaria o que o bot já leu em **todos** os registros — o histórico de
por que cada devolução foi para conferência. Não vale a pena por um rótulo.

**Então a tradução mora nas views**, por `invisible` de valor. As frases são as de
`Config.gs`, tabela `CONFERENCIA`, campo `textoCoordenador` — as mesmas que a pessoa recebe
no WhatsApp, sem os asteriscos do negrito. No card elas são mais curtas, porque é card.

**A lista é o caso que não tem solução por view:** coluna de lista não tem onde traduzir um
char. A coluna saiu do padrão (`optional="hide"`, e passou a se chamar "Conferência
(código)"), e continua disponível no menu de colunas para quem quiser o valor cru. Quem só
precisa saber se deve olhar tem o badge de status e o de validação ao lado.

**Duas barreiras contra o código novo esquecido:**
1. `conta-mensagens.js` lê a tabela `CONFERENCIA` do `Config.gs` de verdade — recortada e
   avaliada, não copiada — e recusa qualquer código sem frase nas duas views. Conferido que
   acusa: acrescentei um `chave_ilegivel` ao Config e as quatro checagens ficaram vermelhas.
2. No arch, um `<span>` de reserva que mostra o código cru quando o valor não é nenhum dos
   conhecidos. Sem ele, um código novo faria o banner aparecer **vazio** — pior que o código.

*Também corrigido em 21/09:* o espaço que faltava depois dos dois-pontos.

---

### BL-68 — "Leitura automática do comprovante" em lançamento sem comprovante ✅ (P)

A Devolução 02/2026 é um lançamento manual, em dinheiro, sem comprovante nenhum — e o
formulário anunciava "Leitura automática do comprovante: Pendente". O rótulo prometia uma
leitura que não houve.

Sem comprovante o rótulo passa a ser "Situação (lançamento sem comprovante)". O badge
continua: `Pendente` segue significando alguma coisa num lançamento manual — ninguém
conferiu ainda.

---

### BL-62 — O ciclo de vida da devolução 🟠 (G)

**Desenho fechado em 22/09**, depois de uma revisão que mudou a forma. O Odoo já está
pronto; falta o Apps Script.

#### Os quatro estados, e por que não são três

A proposta inicial tinha três: Pendente (não devolvido), Confirmado, Rejeitado. A revisão
achou o buraco: **hoje `Pendente` não significa "não devolveu"** — significa "o comprovante
chegou e o bot não conseguiu confirmar", e é a maioria dos casos (7 de 9 na tela de
Ofertas). Com três estados, quem pagou com comprovante ilegível apareceria junto com quem
não pagou, sem como distinguir depois.

| valor gravado | rótulo | o que é |
|---|---|---|
| `A devolver` | A devolver | o mês existe como compromisso e ninguém devolveu ainda |
| `Pendente` | Em conferência | o comprovante chegou, o bot não confirmou |
| `Confirmado` | Conferido | o comprovante bate com o cadastro da comunidade |
| `Rejeitado` | Não confere | o comprovante diverge |

**Só um valor novo.** Os três que existem mantêm o valor gravado e mudaram só o rótulo —
nada foi migrado, e o `Config.gs` não muda uma linha.

"Rejeitado" virou "Não confere" porque acusava a pessoa: o registro não foi rejeitado, o
comprovante não bateu. Quem lê isso antes de ligar para alguém precisa da diferença.

Em cima disso continua a **validação do agente da pastoral** (BL-60), que vale mesmo quando
o bot já disse Conferido ou Não confere: A validar → Validado / Não recebido.

#### Feito no Odoo (22/09)

- `ferramentas/instalar-status-dizimo.mjs` — acrescenta `A devolver`, renomeia os rótulos,
  ordena o ciclo. **Confere que o campo é `selection` antes de escrever**, e para com
  explicação se não for: foi supor exatamente isso que fez o BL-61 mudar de plano no meio.
- **Obrigatoriedade condicional no formulário.** Era `required="1"` fixo em data e valor.
  Um `A devolver` não tem nenhum dos dois, e quem abrisse um desses e salvasse seria
  obrigado a inventá-los — transformando o registro em devolução paga aos olhos da
  classificação, do lembrete mensal e do relatório. Agora é
  `required="x_studio_status != 'A devolver'"`.
- A validação **some** no `A devolver`, no card e nos botões: mês que ninguém pagou não tem
  o que validar, e enchê-la de meses futuros arruinaria a fila do BL-60.
- Badge cinza para o estado novo, na lista, no card e no formulário.

#### Feito no Apps Script (22/09)

- **A competência é gravada** em toda devolução: o mês da data da devolução.
  **Fecha o BL-57** — o agrupamento "Mês Referencia" deixa de cair num balde "Nenhum".
- **O mês em aberto é preenchido**, não duplicado: quando existe um `A devolver` da mesma
  competência, é nele que o pagamento entra (`write`, não `create`).
- **O mês seguinte é aberto** ao registrar um dízimo — sem data, sem valor, sem comprovante
  e **sem validação**. Idempotente: se já existir em qualquer estado, nada acontece.
- Dezembro abre janeiro do ano seguinte.
- Oferta não entra no ciclo.
- Tudo guardado por `campoExiste`: numa base sem o campo de competência, o bot registra
  exatamente como registrava antes.
- A abertura do mês seguinte roda em `try` próprio: previsibilidade não pode derrubar o
  registro de um pagamento que já aconteceu.

**13 cenários no `conta-mensagens.js`, contra o `registrarDevolucao` de verdade.**

**Um achado do próprio harness, que valia mais que os testes:** o Odoo de mentira devolvia
`[]` para qualquer pergunta de schema fora de dois casos especiais. Isso significa que
**todo caminho guardado por `campoExiste` era pulado** e parecia coberto — o BL-62 nasceu
verde sem nunca ter rodado uma linha. O cenário agora declara quais campos existem.

#### A pergunta da competência — feita em 22/09, invertendo a ordem

Quando a pessoa tinha um mês em aberto **anterior** ao que acabou de ser registrado — pagou
em dezembro com setembro em aberto — o bot não tem como saber de qual mês é o pagamento, e
adivinhar seria inventar um fato sobre dinheiro.

**Registra primeiro, pergunta depois.** Perguntar antes obrigaria a segurar o comprovante em
sessão: base64 de 100 KB a 1 MB, contra **100 KB por chave** no `CacheService` e **9 KB por
valor** no `PropertiesService`. Não cabe — e criaria um caminho em que a pessoa some no meio
e o pagamento se perde.

> 📅 Registrei como referente a **dezembro/2026**.
> Vi que você tem **setembro/2026** em aberto. Se este dízimo era daquele mês, é só me dizer
> que eu acerto.
> `[ setembro/2026 ]` `[ Está certo ]`

**Duas correções em 23/09, e a segunda consertou a primeira.**

A condição da pergunta errou duas vezes, sempre por não separar *mês em aberto* de *mês
devido*:

| versão | o que procurava | o que acontecia |
|---|---|---|
| 1ª | competência **anterior** à registrada | pessoa com *maio* em aberto mandou comprovante de abril; maio é posterior, então o bot gravou abril **calado** |
| 2ª | competência **diferente** da registrada | `registrarDevolucao` **abre o mês seguinte antes** de a oferta rodar; a busca achava esse mês recém-criado e **toda devolução passava a perguntar**, oferecendo um mês futuro como se fosse dívida |
| 3ª | competência **anterior ao mês corrente** e diferente da registrada | mês que ainda não terminou é compromisso, não dívida |

O critério certo não é a relação com a competência paga — é a relação com **hoje**. Dívida é
mês que já passou e não foi devolvido; o mês que o bot acaba de abrir é, por definição, o
próximo compromisso.

*No mesmo teste:* o `A devolver` aparecia na lista com forma de pagamento **"Dinheiro"** — o
padrão do campo no Odoo, num mês que ninguém devolveu. Dado inventado na coluna que o
coordenador lê. Passa a nascer vazio.

**O fake do harness também errava duas vezes:** não honrava `!=`, e depois honrava só a
**primeira** condição de competência do domínio — o que teria aprovado de olhos fechados a
versão que perguntava sempre. Agora aplica todas.

**Os dois ids viajam dentro do id do botão**, não em sessão. É o que faz a correção funcionar
horas depois, com a sessão já expirada — que é o caso normal, já que a devolução é encerrada
antes de a pergunta sair.

**A correção TROCA as competências**, não copia: se o dízimo era de setembro, setembro passa
a ser o mês pago e dezembro volta a ficar em aberto. Copiar deixaria dois registros de
setembro, um pago e um que nunca fecharia.

**Só manda mensagem quando há dúvida de verdade.** Competência que bate, ou nenhum mês
anterior em aberto: nada é enviado, e a contagem de mensagens do fluxo normal não muda.

**Coberto por 7 cenários**, incluindo o caso em que o mês em aberto é o mesmo que foi pago
(não pergunta), o botão estragado (avisa em vez de estourar) e o "Está certo" (não escreve
nada).

**Um defeito achado no próprio harness:** o Odoo de mentira tratava todo domínio como
igualdade e ignorava o operador. A busca pelo mês anterior usa `<` — então ela não achava
nada, enquanto o mês *igual* ao pago era devolvido como se fosse anterior. Mentia nos dois
sentidos. O fake passou a honrar `<`, `<=`, `>` e `>=`.

**O que ficou de fora, de propósito:** o lote de família (`ComprovanteHandler.gs:359`) não
oferece correção. São várias devoluções numa submissão, e uma pergunta por membro viraria
uma rajada de mensagens. Quem lança por família corrige pela tela do Odoo.

**Fora do desenho, de propósito:** oferta não ganha `A devolver`. Oferta não é compromisso
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

### BL-64 — Validar direto do card do kanban 🟠 (M)

O kanban é a tela que abre no celular, e validar exigia abrir cada registro.

**O que está versionado neste repositório:** o badge de validação no card — cinza enquanto
ninguém olhou, verde validado, vermelho não recebido. Isso é view pura e sobe com um
`--update` comum.

**O que não pode ser versionado direto:** os botões. Botão de kanban que faz alguma coisa
chama uma `ir.actions.server` por **ID numérico**, e esse ID nasce quando a ação é criada
nesta instância. Um arquivo aqui não tem como carregá-lo, e escrever um número às cegas
produz botão que aponta para o nada.

**O caminho que resolve isso**, em `ferramentas/instalar-botoes-kanban.mjs`:

1. cria as duas ações (idempotente pelo nome) e descobre os IDs
2. troca o comentário `MARCADOR-BOTOES-VALIDACAO` do arch pelo bloco de botões já com os
   números certos, direto no Odoo
3. um `baixar-views --download` traz o resultado para cá, e a view volta ao caminho normal

Depois do passo 2 o `--update` passa a **pular** esta view, porque o arch do Odoo deixa de
bater com a impressão digital do índice. É a trava nº 3 do `baixar-views` fazendo o
trabalho dela, não um defeito — mas é motivo para não adiar o `--download`.

**Descartado: o widget `state_selection`**, que seria uma linha em vez de um instalador. Na
`saas-19.3` ele não colore: o mapa está cravado no código do widget
(`{blocked: "red", done: "green"}`) e qualquer outro valor cai em cinza. Os três estados
ficariam com o mesmo pontinho, e um kanban que não se varre com o olho não serve. Conferido
na fonte, não deduzido.

**Travado por teste:** `conta-mensagens.js` roda a substituição do marcador contra o arquivo
de verdade e recusa se ela deixar de pegar — o instalador roda na máquina de quem usa, onde
o erro apareceria tarde.

---

### BL-65 — Calendário de aniversariantes por comunidade 🟠 (M)

**O defeito que estava lá desde sempre:** a view de calendário de `x_dizimista` (595) tinha
`date_start="x_studio_date"` — a **data de nascimento**. O calendário posiciona o evento
pela data que o campo guarda, e o campo guarda `14/03/1975`. A view abria, funcionava, e
não mostrava ninguém em nenhum mês que alguém fosse abrir.

Sem erro, sem aviso. Um calendário vazio não parece quebrado: parece que ninguém faz
aniversário. É a mesma família do filtro "Mês Atual" (BL-57/#104) e do mapa de dizimista
(BL-58) — tela que existe, não falha, e não serve.

**A solução, e por que ela custa uma ação agendada:**

`x_studio_aniversario` guarda o mesmo dia e mês no **ano corrente**, e é para ele que o
calendário aponta.

Campo calculado seria mais elegante e não funciona: calculado só recalcula quando uma
dependência muda. A dependência seria a data de nascimento, que não muda nunca — e o que
muda é o **ano**, que não é dependência de coisa alguma. Em 1º de janeiro o campo ficaria
com o ano velho e o calendário esvaziaria de novo, em silêncio.

Campo gravado mais ação diária resolve. O custo é baixo: a ação só **escreve onde o valor
difere**, então depois da virada do ano são 364 dias de uma leitura e nenhuma escrita. E as
escritas são agrupadas por data — numa paróquia de 508 pessoas, muitas dividem aniversário.

**29 de fevereiro:** `date(1976,2,29).replace(year=2027)` levanta `ValueError`. Sem tratar,
**uma pessoa derruba a ação inteira** e ninguém mais é atualizado. Cai em 28/02, como o
calendário civil brasileiro faz. Está coberto por teste, e conferi que o teste acusa quando
o tratamento sai.

**Arquivos:**
- `ferramentas/odoo-acoes/atualizar-aniversarios.py` — a fonte versionada da ação
- `ferramentas/odoo-acoes/teste-aniversarios.py` — 13 cenários executando o arquivo de
  verdade contra um Odoo de mentira
- `ferramentas/instalar-aniversarios.mjs` — campo, cron e `calendar` no view_mode
- a view 595 reescrita: cor e coluna de filtros por comunidade, balão com telefone,
  nascimento e classificação, `create="false"`

**A data de nascimento não é tocada.** A ação lê `x_studio_date` em dois lugares (o
domínio da busca e o valor) e escreve num só campo, `x_studio_aniversario`. Como ela varre
os 508 dizimistas todo dia, um `write` errado ali apagaria a base inteira de datas de
nascimento, sem volta e sem nada acusando — então a garantia é conferida por três
verificações, e não combinada: os campos realmente escritos em três execuções, as datas de
nascimento antes e depois, e uma leitura da árvore sintática do arquivo procurando
`x_studio_date` dentro de qualquer chamada a `write()`. Conferido que as três acusam quando
a escrita indevida é introduzida.

**Conferido na tela em 22/09**, com um achado que não é defeito: o ano de 2026 inteiro
mostra **seis** datas, e o painel lateral lista três comunidades em vez de seis. Com 508
dizimistas o esperado seria quase todo dia colorido. A explicação é que a base atual é de
**teste**, criada sem data de nascimento — a tela está certa, o dado é que não existe.

⚠️ **Isto volta quando a base real entrar.** Se o import não trouxer a data de nascimento,
o calendário nasce vazio de novo e vai parecer defeito pela segunda vez. A data precisa
estar no mapeamento do import.

**Uma coisa que o instalador conta e vale ler:** quantos dos 508 dizimistas têm data de
nascimento preenchida. Se forem poucos, o calendário nasce quase vazio — e aí o que falta é
cadastro, não view. Melhor saber antes de abrir a tela.

---

### BL-66 — Dízimos e ofertas por mês ✅ (P)

**O que existia:** o pivô de `x_devolucao` era literalmente
`<pivot><field name="x_studio_value" type="measure"/></pivot>` — abria num número só, o
total de tudo desde sempre, sem linha nem coluna. E o gráfico agrupava por
`x_studio_competencia`, que o bot nunca grava (BL-57), então virava uma barra chamada
"Nenhum".

**O que passa a existir:** mês nas linhas, tipo de contribuição nas colunas, e três
medidas — valor, quantidade de lançamentos, e **pessoas distintas**. Essa última sai de
graça: o Odoo agrega medida `many2one` como `count_distinct`, então
`x_studio_dizimista` responde "quantas pessoas diferentes contribuíram", que não é o mesmo
que quantos lançamentos houve.

**"Informo a comunidade e o mês"** vira isto:
- a **comunidade** já está no painel da esquerda — a view de busca tem `<searchpanel>` com
  `x_studio_comunidade`, e um clique isola a sua
- o **mês** é a primeira linha, e não um campo a preencher: todos aparecem, com setembro ao
  lado de agosto — que é a pergunta que vem logo depois de "quanto entrou em setembro"

Uma tela de formulário com dois campos e um botão exigiria um modelo transitório e código
Python, que o Odoo Online com Studio não comporta sem módulo; e entregaria **menos**, porque
mostraria um mês de cada vez e não exportaria para planilha.

**⚠️ O total é bruto**, de propósito. Entra tudo que foi registrado, inclusive o que o bot
marcou como `Rejeitado` e o que o coordenador marcou como `Não recebido`. Relatório que
esconde linha sozinho faz dinheiro sumir sem explicação. Para separar, basta acrescentar
"Validação" como linha ou coluna pelo menu do próprio pivô — o agrupamento já está na view
de busca desde o BL-60.

**Se a paróquia quiser o número líquido como padrão**, o caminho é um filtro padrão no
contexto da ação (não na view), e vale decidir junto o que conta: só `Validado`, ou
`Validado` mais `A validar`.

**Conferido na fonte da `saas-19.3`, não deduzido:** `interval` em campo de data
(`pivot_arch_parser.js`), `__count` como medida declarável no XML e o `string` dela sendo
respeitado (`views/utils.js:87,120`), medida `many2one` virando `count_distinct`
(`pivot_model.js:1080`), e `stacked`/`type` na raiz do gráfico (`graph_arch_parser.js:20`).

---

### BL-67 — O `--download` apagou trabalho já mesclado 🔴 (P)

**Aconteceu em 22/09, em produção.** Um `--download` passou por cima de duas views
editadas neste repositório e ainda não levadas ao Odoo com `--update`: o pivô do BL-66 e o
calendário do BL-65 voltaram à versão antiga. Dois PRs já mesclados, desfeitos — e o
`git status` mostrou isso como se fosse o resultado normal de baixar.

**A causa:** o download comparava só **dois** lados, disco e Odoo. Vendo-os diferentes,
escolhia o Odoo. Mas "diferentes" não diz *quem se moveu* — e sem isso a escolha é chute.

O `indice.json` guarda a digital do que o Odoo tinha no download anterior. Com essa terceira
referência a pergunta tem resposta:

| disco | Odoo | o que fazer |
|---|---|---|
| = base | ≠ base | o Odoo mudou → **baixar** |
| ≠ base | = base | só o disco mudou → **preservar**, e dizer que falta `--update` |
| ≠ base | ≠ base | os dois mudaram → **preservar**, e avisar que é conflito |
| — | igual ao disco | mesmo significado → **manter** o texto do disco |

`--forcar` continua descartando a edição local de propósito.

**O `--update` já tinha a trava no sentido contrário** desde o começo — ele não passa por
cima do que mudou no Studio. Faltava a simétrica. Uma metade de uma trava não é uma trava:
é uma armadilha com um lado seguro.

**Travado por teste:** a decisão virou uma função pura (`decidirDownload`) e o
`conta-mensagens.js` exercita os sete casos. Conferi que dois deles ficam vermelhos com a
lógica que estava em produção.

**O que foi restaurado:** `x_devolucao.pivot.606` e `x_dizimista.calendar.595`, do commit
anterior ao download. Nada mais se perdeu — o resto do que o download trouxe era o Odoo
normalizando arch (comentário de várias linhas virando uma, xpath reescrito na forma
posicional), que é o estado verdadeiro e fica.

---

### BL-69 — A idade do comprovante ✅ (P)

**Não havia checagem nenhuma.** Um comprovante de 2020 registrava como qualquer outro.

**A regra:** comprovante com mais de **60 dias**, ou com data **no futuro**, cai em
`Não confere` e a pessoa é avisada. É mais duro que o resto da tabela de conferência, de
propósito: chave que não bate pode ser layout de banco que não entendemos; data é data.

| prazo considerado | por que não |
|---|---|
| 5 dias | pegaria quem paga no dia 1º pelo mês anterior. Falso positivo todo mês |
| 30 dias | apertado para quem pagou e esqueceu de mandar por três semanas |
| **60 dias** | dois meses é onde deixa de ser plausível como "dízimo deste mês" |
| 90 dias | passa da janela de 3 meses da classificação; já não diz nada sobre o mês corrente |

**É parâmetro, não número no código:** `x_studio_dias_comprovante` em x_parametros, criado
por `ferramentas/instalar-dias-comprovante.mjs`. Quem sabe se dois meses é muito ou pouco é
a paróquia. Em branco, ou fora de 1..365, vale o padrão de fábrica — a regra funciona antes
de o campo existir.

**Precedência:** chave divergente é mais grave e continua mandando. A idade só decide quando
a chave conferiu ou não foi lida.

**Data ilegível não acusa nada.** O BL-52 fez a leitura funcionar em vários layouts, mas ela
ainda falha — e chamar de "antigo" um comprovante cuja data não conseguimos ler seria acusar
alguém do nosso próprio limite.

**Data no futuro vem de graça na mesma checagem**, com código próprio: é impossível, e
denuncia adulteração ou erro de leitura. Ações diferentes, códigos diferentes.

*Achado ao escrever:* o `textoCoordenador` que eu tinha posto trazia `{dias}`, e nada no
projeto substitui essa chave — a pessoa leria "o comprovante tem mais de {dias} dias" no
WhatsApp. A barreira do BL-61 obrigou a escrever a frase nas views, e foi ali que apareceu.

**12 cenários**, incluindo o limite exato (60 passa, 61 não), parâmetro absurdo voltando ao
padrão, e o caso que importa: antigo **com a chave certa** vira `Não confere` e avisa.

---

### O pagamento no dia 1º pelo mês anterior — já resolvido

Pagar em 01/10 o dízimo de setembro dá competência *outubro*, que está errado. Não precisou
de código novo: setembro está em aberto e é anterior ao mês corrente, então o mecanismo do
BL-62 pergunta *"vi que você tem setembro/2026 em aberto…"* e a troca de competências
resolve. Só não funciona para quem nunca devolveu antes — e aí não há o que adivinhar.

---

### BL-70 — A pergunta do mês, por intervalo ✅ (M)

**O sintoma, no teste de 23/09:** o dizimista tinha julho pago, mandou um comprovante de
setembro, e o bot gravou setembro **calado**. Agosto nunca foi mencionado.

**A causa:** a pergunta do BL-62 só existia quando havia um registro `A devolver` para
oferecer. Mas a corrente abre **um mês por vez** — pagou julho, abre agosto; pagou setembro,
abre outubro. Quem pula um mês tem esse mês **sem registro nenhum**, e não havia o que
oferecer.

**Por que não bastava preencher os meses que faltam**, que foi a minha primeira proposta:
há quem devolva de dois em dois ou de três em três meses por hábito. Para essa pessoa agosto
não é dívida — é o ritmo dela. Criar o registro seria decidir por ela que ela deve.

**A regra nova:** os candidatos vão do mês seguinte à **última devolução paga** até o mês
que acabou de ser registrado. Mais de um candidato, pergunta; um só, silêncio.

| situação | candidatos | pergunta? |
|---|---|---|
| pagou agosto, registra setembro | setembro | não |
| pagou julho, registra setembro | agosto, setembro | **sim**, 2 botões |
| pagou maio, registra setembro | jun…set | **sim**, vira lista |
| primeira devolução da vida | — | não, não há de onde contar |

O mês registrado vem **primeiro** na lista: é o palpite do bot, e quem concorda toca no
primeiro item sem ler o resto. Até três opções viram botão (um toque); acima disso, lista —
quem devolve de três em três meses chega a quatro.

**Teto de 6 opções.** Quem some por anos geraria uma lista impossível de ler; seis cobrem com
folga o ritmo mais espaçado que a paróquia descreveu.

**Ao escolher um mês:** se existe um `A devolver` daquele mês, as competências **trocam**. Se
não existe, só grava — inventar um `A devolver` para o mês que sobrou seria, de novo, decidir
pela pessoa que ela o deve.

**O formato antigo do botão (`comp_<id>_<id>`) continua roteado**, para as mensagens que
saíram antes desta mudança e ainda estão na conversa de alguém.

*Terceira vez que o fake do harness mentiu por ignorar um operador* — desta vez `!=` no
status, na busca pela última devolução **paga**. Agora compara operador em status e em
competência.

---

### BL-72 — No lote de um membro, vale o valor do comprovante ✅ (P)

**Eu tinha entendido ao contrário.** Quando a paróquia disse *"o valor de cadastro é somente
uma inclinação, a pessoa devolve o que quiser"*, registrei como "não precisa avisar da
diferença". O sentido era o oposto: **o valor escolhido é irrelevante — vale o que foi pago**.

O sintoma, no teste de 23/09: comprovante de **R$ 400**, registro de **R$ 100**. O relatório
do mês ficava R$ 300 menor que o extrato, e o número no Odoo não correspondia a dinheiro
nenhum.

**A regra:** no lote com **um membro**, o valor do comprovante manda. É a mesma do BL-53, que
valia só para oferta — e o caminho do dizimista único já fazia assim; só o lote de família
não.

**Com vários membros, a alocação da conversa continua mandando.** O comprovante traz um total
e não há como dividi-lo entre as pessoas; ali a conversa é a única informação que existe.

---

### BL-71 — A regra de ouro, e a remoção do ciclo automático ✅ (M)

**Decisão da paróquia em 23/09, depois de três tentativas minhas de consertar a pergunta do
mês.** Cada uma resolvia um caso e criava outro:

| tentativa | o que fazia | o que quebrava |
|---|---|---|
| BL-62 | perguntava quando havia um `A devolver` **anterior** | quem tinha maio aberto e pagou abril passava calado |
| #120 | qualquer `A devolver` **diferente** | achava o mês que o próprio bot acabara de abrir → perguntava **sempre** |
| BL-70 | o **intervalo** desde a última devolução paga | funcionava, mas com lista de até 6 opções e um modelo mental caro |

A causa comum era a **pré-criação do mês seguinte**. Ela existia para dar previsibilidade e
produzia: mês fantasma para quem devolve de dois em dois meses, registros que ninguém pediu,
e um buraco sem rastro quando alguém pulava um mês.

**Removida.** `registrarDevolucao` voltou a só criar a devolução, com a competência.

#### A regra de ouro

- **Primeira devolução da vida** → registra na competência devida, não pergunta nada.
- **Não é a primeira, e o mês anterior não tem devolução** → pergunta: *este mês ou o
  anterior?* Duas opções, sempre.
- **Mês anterior coberto** → silêncio.

Tudo relativo à **competência registrada** (o mês da data do comprovante), não ao dia de
hoje. É o que faz o caso mais comum funcionar sozinho: quem paga no dia 1º de outubro pelo
dízimo de setembro tem competência outubro, setembro vazio, e a pergunta aparece.

**Ao escolher, só grava.** Não cria registro para o mês que sobrou, não reabre nada — o bot
não sabe se aquele mês é dívida ou o ritmo de quem devolve de dois em dois meses.

`A devolver` **não conta como devolução** na verificação do mês anterior: é previsão, não
pagamento. Restam alguns registros na base, de antes desta mudança; podem ser apagados à mão.

O botão do formato antigo (`comp_<id>_<id>`) responde com um aviso honesto em vez de estourar
— há mensagens dele em conversas de ontem.

**Corrigido em 23/09, no teste seguinte:** a pergunta não aparecia para quem usa o fluxo de
**família**. Quem toca em "De quem é a devolução?" e escolhe uma pessoa passa por
`_tratarResultadoFamilia`, e eu só tinha ligado a pergunta no caminho do dizimista único.

O motivo estava escrito por mim no BL-62 — *"uma pergunta por membro viraria uma rajada de
mensagens"* — e continua valendo para família de verdade. Mas **lote de um não é lote**:
agora o lote com exatamente um membro recebe a pergunta, e com vários segue sem. Com vários,
uma pergunta só não teria resposta possível — cada pessoa pode estar num mês diferente.

**17 cenários**, incluindo o caso do teste real (julho pago, comprovante de setembro), o
pagamento no dia 1º, quem sumiu por anos (continua sendo *uma* pergunta de duas opções), e o
`A devolver` no mês anterior não cobrindo nada.

---

### BL-17 (segunda metade) — o usuário dedicado do bot 🔴 (M)

**O bot falava com o Odoo como Administrador** (`ODOO_UID = 2`) desde o começo. Quem obtiver
a chave de API — script exposto, conta Google comprometida, acesso ao editor do Apps Script
— podia apagar ou exportar a base inteira: não só devoluções, mas usuários e configurações.

O bot escreve em **três** modelos. Tinha permissão sobre todos.

#### A matriz, levantada das chamadas reais

| modelo | read | write | create | unlink |
|---|:--:|:--:|:--:|:--:|
| `x_devolucao` | ✓ | ✓ | ✓ | |
| `x_dizimista` | ✓ | ✓ | ✓ | |
| `x_contato_bot` | ✓ | ✓ | ✓ | |
| `x_notificacao_log` | ✓ | | ✓ | |
| `x_comunidade` | ✓ | | | |
| `x_parametros`, `x_parametros_line_c498a` | ✓ | | | |
| `ir.model.fields` | ✓ | | | |
| `res.users` | ✓ | | | |

**Nenhum `unlink`, em nada.** O único do projeto está em `reviverPrimeiroContato`
(`Setup.gs:814`), função manual de depuração — não em runtime. Quem precisar dela roda com
credencial de administrador, e isso é uma troca deliberada: uma conveniência de depuração não
justifica dar direito de apagar à integração de produção.

**Nenhuma escrita de schema.** `SetupCamposFamilia` e `SetupCamposOferta` criam campos em
`ir.model.fields`, e são setups manuais executados uma vez. Em runtime o bot só **lê** o
schema (`campoExiste` / `campoGravavel`).

#### O que está no repositório

`ferramentas/instalar-usuario-bot.mjs` cria o grupo **"Meu Dízimo · Bot"** com exatamente
essas permissões, e tem um modo **`--verificar`** que é o que importa: rodado com a chave do
usuário novo, ele pergunta ao próprio Odoo, operação por operação, e acusa **tanto o que
falta quanto o que sobra**.

*Corrigido antes do primeiro uso:* eu tinha escrito `check_access_rights`, que **não existe
mais** nesta versão. Em `odoo/orm/models.py` da `saas-19.3` há `check_access` (levanta
exceção) e `has_access` (devolve booleano) — é o segundo que serve. O verificador teria
estourado no primeiro modelo, e ele é justamente o script cujo trabalho é provar que o resto
ficou certo.

**Custo de usuário: não se aplica.** A paróquia está no plano gratuito do Odoo Online, que
não limita usuários.

**Ele não cria o usuário nem gera a chave**, de propósito: isso é segredo, e segredo não passa
por script que alguém possa reexecutar ou logar.

**Ele também não tira ninguém de Administração.** Avisa em vermelho se o usuário ainda estiver
lá — porque o Odoo **soma** permissões e nunca subtrai, então o grupo novo não limita nada
enquanto isso —, mas tirar acesso por script tranca gente para fora quando o login está errado.

#### Duas armadilhas fechadas junto

**O `|| 2` do `getOdooConfig`.** Propriedade ausente ou com lixo caía silenciosamente no
administrador — um padrão que desfazia este item inteiro sem avisar. Agora não há padrão
nenhum: falta a propriedade, estoura.

**A URL da instância e o nome do banco estavam escritos em `Config.gs` e `Setup.gs`** — e este
repositório é **público**. Só percebi ao responder "é seguro usar essa solução?", olhando o
arquivo em vez da memória. A URL não é credencial, mas diz onde apontar uma tentativa e
confirma o nome do banco.

Passaram a vir só das Script Properties. **Continuam no histórico do git**, e reescrever
histórico de repositório público não desfaz o que já foi lido — trate a URL como conhecida. A
defesa real é a chave e o usuário não-administrador, que é justamente este item.
`conta-mensagens.js` recusa a reintrodução.

#### Ganho secundário: trilha de auditoria

Hoje tudo que o bot faz aparece no Odoo como se o **administrador** tivesse feito. Com usuário
próprio, o histórico de cada registro passa a dizer quem foi — o bot ou uma pessoa.

---

## Itens críticos

### BL-01 — Notificações mensais quebradas 🔴 (M)
**Arquivo:** `NotificacaoHandler.gs` (linhas 148, 197, 215, 242) · `OdooService.gs`
**Problema:** chama `OdooService.executar(...)`, método que não existe (o serviço só expõe `searchRead`, `create`, `write`, `_rpc`). `executarNotificacoesDiarias()` lança `TypeError`. Além disso: filtro por `x_studio_date` (linha 220) em vez de `x_studio_data_da_devolucao`; e `processarRespostaNotificacao` (259) chama `DevolucaoHandler.iniciar` (real: `iniciarDevolucao`) e `HistoricoHandler.mostrar` (inexistente).
**Correção:** reescrever as chamadas usando `searchRead`/`create`; para `search_count`, adicionar um método `count(model, domain)` em `OdooService`. Corrigir o nome do campo de data. Remover ou corrigir `processarRespostaNotificacao`.
**Aceite:** `executarNotificacoesDiarias()` roda sem erro; um dizimista elegível recebe o template; log gravado em `x_notificacao_log`; quem já devolveu no mês não é notificado.

**⚠️ Nota de sequenciamento (auditoria 17/09/2026):** o Sprint 3 abaixo determina fazer **BL-21 e BL-24 antes** de reativar o BL-01 — mas o BL-01 está concluído e **já em produção** (trigger de hora em hora, `NotificacaoHandler.gs:356-358`), enquanto BL-21 e BL-24 seguem abertos. O envio em si é seguro: é sequencial com `Utilities.sleep(2000)` entre mensagens (`:179`), então não há rajada de *saída*. A exposição é a **onda de respostas** que chega nos minutos seguintes — o cenário 6 da análise de carga — batendo num webhook sem retry/backoff (BL-24) e sob o teto de ~30 execuções simultâneas (BL-21). **Recomendação:** priorizar BL-24 antes do próximo ciclo mensal de notificações, ou reduzir o alcance do disparo (lotes menores por hora) até que BL-21/BL-24 estejam fechados. **Situação em 23/09:** as duas metades foram feitas — o BL-24 está concluído (`Utils.fetchComRetry`) e o **BL-73** escalonou o disparo em lotes configuráveis (padrão: 20 a cada 2h, das 9h às 17h). O teto do BL-21 continua de pé para o tráfego normal, mas o disparo de lembretes deixou de ser um gatilho previsível para encostar nele.

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

## Publicação de 22/09/2026 ✅

`clasp push` e nova versão do deployment feitos em 22/09. Passou a valer no bot, de uma vez:

| | |
|---|---|
| BL-52 | a data do comprovante em qualquer layout |
| BL-53 | a oferta grava o valor do comprovante, não o digitado |
| BL-62 | competência, mês em aberto preenchido, mês seguinte aberto, e a pergunta do mês |

Era a primeira publicação desde 20/09 — os três subiram juntos, e nenhum deles tinha rodado
uma vez em produção. O roteiro de conferência está logo abaixo; o que ele pede em primeiro
lugar é um dízimo de verdade, porque é o caminho que os três atravessam.

⚠️ **O `registrarDevolucao` passou a fazer mais chamadas RPC por devolução** (procurar o mês
em aberto, conferir se o mês seguinte já existe, e às vezes um `write` no lugar do `create`).
Todas são guardadas: se qualquer uma falhar, a devolução é registrada do mesmo jeito e só a
previsibilidade se perde. Mas isso interage com BL-24 (sem retry) e BL-21 (teto de execuções),
que seguem abertos — vale olhar o tempo de execução no log depois das primeiras devoluções.

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

### BL-73 — O disparo de lembretes é escalonado ✅ (M)

**Pedido (usuário, 23/09):** *"Nao vai ocorrer 500 notificações de uma vez. Exceto se tiver 500
dizimistas com data de devolução no mesmo dia. Mas uma forma de mitigar é escalonar. A rotina
pode executar a cada 2h e pega 20 dizimistas para notificar. Os alertas devem ser entre 9h e 17h.
Todos esses parâmetros devem ser configuráveis."*

**O diagnóstico estava certo, e já estava escrito aqui.** A nota de sequenciamento do BL-01
(auditoria 17/09) recomendava exatamente isto: *"reduzir o alcance do disparo (lotes menores por
hora) até que BL-21/BL-24 estejam fechados"*. Ficou registrada e não foi feita.

**O que era o risco, e o que NÃO era.** O envio nunca foi o gargalo: ele já é sequencial, com
`Utilities.sleep(2000)` entre mensagens, então não havia rajada de *saída*. O problema é a **onda
de volta** — quem recebe o lembrete responde nos minutos seguintes, cada resposta é uma execução
do webhook, e o teto de ~30 execuções simultâneas do Apps Script (BL-21) é compartilhado por
todos os usuários. Notificar 500 pessoas de uma vez não trava o envio; trava a conversa de todo
mundo depois dele. Havia ainda um segundo problema, mais silencioso: a seleção fazia **duas
consultas ao Odoo por candidato**, então 500 dizimistas eram ~1000 RPCs numa execução com teto de
6 minutos.

**O que passou a valer.** Quatro números em `x_parametros`, todos inteiros, todos com padrão de
fábrica em `NOTIFICACAO_PADRAO` (Config.gs) e faixa em `NOTIFICACAO_LIMITES`:

| Campo | Padrão | Faixa | O que é |
|---|---|---|---|
| `x_studio_notif_hora_inicio` | 9 | 0..23 | a partir de que hora se pode tocar o telefone |
| `x_studio_notif_hora_fim` | 17 | 1..24 | até que hora — **exclusivo** |
| `x_studio_notif_intervalo` | 2 | 1..12 | de quantas em quantas horas sai um lote |
| `x_studio_notif_lote` | 20 | 1..200 | quantos lembretes por lote |

Com os padrões: disparos às **9h, 11h, 13h e 15h**, 20 cada — 80 por dia.

**`horaFim` é exclusivo**, como sempre foi nesta rotina. `17` quer dizer que o último disparo
acontece **antes** das 17h — com intervalo 2 e início 9, o último é o das 15h. Para incluir a hora
das 17h, o valor é `18`. Está escrito na descrição do campo, que é onde a paróquia lê antes de
digitar.

**O acionador continua de hora em hora, de propósito.** Trocar para `everyHours(2)` seria o
caminho óbvio e estaria errado: o intervalo passaria a morar no Apps Script, e mudá-lo exigiria
alguém abrir o editor e reinstalar o acionador — o pedido era que **todos** os parâmetros fossem
configuráveis, e isso só se sustenta se a decisão for tomada a cada execução, com o número que
está no Odoo agora. O preço são as ~20 execuções diárias que acordam, leem `x_parametros` e
terminam. É barato, e é o que paga a configurabilidade. O harness reprova quem "otimizar" isso.

**O teto é uma PARADA, não um corte.** `buscarDizimistasElegiveis(limite)` para de examinar
candidatos assim que enche o lote. A diferença não é cosmética: cortar no fim gastaria as ~1000
RPCs mesmo assim, com o log dizendo "20 enviados" — exatamente o que se esperava ver. Há um caso
no harness que conta as consultas de histórico e reprova se passarem de `2 × lote`.

**A fila anda, e ninguém é perdido.** Quem fica de fora de um lote continua elegível no disparo
seguinte, porque a repescagem notifica **a partir** do dia de notificação, não só nele, e
`jaFoiNotificadoEsteMes` tira da conta quem já recebeu. A ordem é `dia_preferido asc, id asc`:
quem venceu primeiro é notificado primeiro, e o desempate por id é estável, de modo que a fila não
embaralha entre disparos.

**O que se recusou a fazer, e por quê.** Três decisões onde o lado "seguro" seria calar:

1. **`x_parametros` ilegível não suprime o disparo** — sai com o padrão de fábrica, que é
   conservador por construção. O oposto seria uma instabilidade de rede às 9h suprimindo o
   lembrete do dia inteiro.
2. **Número fora da faixa volta ao padrão e avisa no log** — `lote: 0` calaria a rotina para
   sempre, `lote: 9999` traria de volta a rajada que isto existe para evitar.
3. **Janela invertida (`fim <= início`) volta ao padrão** — é a única combinação rejeitada como
   *conjunto*: cada número sozinho está na faixa, mas juntos fecham a janela e o lembrete nunca
   mais sai, em silêncio.

**O modo de falha deste desenho é silencioso**, e por isso ganhou uma ferramenta própria:
`previsaoEscalonamento()`, no editor do Apps Script, imprime a janela, os degraus do dia, o teto
diário e quantos dias levaria para percorrer a fila de hoje — avisando quando passa de 3. Um lote
pequeno demais não dá erro nenhum; só faz o lembrete de alguém chegar dias depois.

**Cobertura:** 23 casos novos no `conta-mensagens.js`, rodando `executarNotificacoesDiarias`
inteira contra stubs com o relógio e a resposta do Odoo fixados. **12 deles reprovam contra o
código anterior** — conferido revertendo os dois arquivos e rodando o harness. Mais duas
verificações estruturais: os padrões e faixas de `Config.gs` têm de bater com os do instalador (a
descrição do campo é o único lugar onde a paróquia lê a faixa), e o acionador tem de continuar
`everyHours(1)`.

**Instalação:**

```
node ferramentas/instalar-escalonamento-notificacao.mjs            # simula
node ferramentas/instalar-escalonamento-notificacao.mjs --aplicar  # grava
```

Depois, arrastar os quatro campos para o formulário de Parâmetros no Studio — criar o campo não o
põe na tela. **O escalonamento já vale sem isso**, com o padrão de fábrica; o instalador serve
para poder ajustar.

**Fica aberto:** o BL-73 mitiga o BL-21, não o fecha. O teto de execuções simultâneas continua de
pé para o tráfego normal de conversas; o que mudou é que o disparo de lembretes deixou de ser um
gatilho previsível para encostar nele.

---

### BL-75 — O teto de 50 propriedades do editor ✅ (P)

**Sintoma (usuário, 24/09):** *"Criei o novo usuário, mas não consigo editar no properties porque
passou de 50 propriedades."* O editor do Apps Script mostra no máximo 50 propriedades e, acima
disso, **a lista inteira vira somente leitura** — perde-se a tela de configuração, não só o
excedente. Sem ela não dá para trocar `ODOO_UID` nem `ODOO_API_KEY`, que era exatamente o passo
que faltava no **BL-17**.

**O diagnóstico errado, e por que ele era tentador.** A primeira leitura foi "os contadores nunca
são apagados". Está errada: a poda automática existe e funciona — `Utils._somarShards` descarta os
períodos vencidos a cada passagem, de carona na trigger de sessões, a cada 20 minutos. O que
falhou não foi a limpeza, foi a **aritmética da retenção**:

| Chave | Retenção | Shards | Regime permanente |
|---|---|---|---|
| `uso_urlfetch_<dia>_<0..4>` | 7 dias | 5 | 35 |
| `msgs_<mês>_servico\|template_<0..4>` | **6 meses** | 5 | **60** |
| configuração | — | — | 27 |

**~120 propriedades em operação normal.** O teto de 50 seria cruzado na primeira semana, e foi. O
harness calcula 93 contra o código anterior.

**O achado que resolve:** das ~95 chaves de contador, **15 eram lidas**. `verificarCotaUrlFetch`
soma só **hoje**; `somarMensagensDoMes` e `verificarCotaMensagens` somam só o **mês corrente**.
As outras 80 eram escrita sem leitor — histórico que nenhuma tela mostra. Guardar seis meses
custava 60 propriedades para servir 10.

**O que passou a valer:**

| Constante | Era | É | Custo |
|---|---|---|---|
| `URLFETCH_DIAS_GUARDADOS` | 7 (literal na poda) | 2 | nenhum — ninguém lê ontem |
| `MSG_MESES_GUARDADOS` | 6 | 2 | nenhum — ninguém lê mês passado |
| `URLFETCH_SHARDS` | 5 | 2 | ⚠️ real, ver abaixo |

Regime permanente: 12 contadores + 27 de configuração + 6 de folga = **45**.

**O shard é o único custo real, e não é de graça.** Ele existe porque `setProperties` é
read-modify-write sem trava, então execuções simultâneas perdem incremento. De 5 para 2 a colisão
fica mais provável e a contagem subestima um pouco mais. Aceitei porque é telemetria, não
dinheiro; porque já subestimava sob concorrência; e porque ficar trancado fora da própria
configuração custa mais. O **BL-74 Fase 3** troca o mecanismo por `INCR` no Redis, que é atômico
de verdade e dispensa shard.

Foram 3 shards primeiro. **O harness reprovou em 51** — as 27 chaves de configuração são piso e
não podem ser podadas, então a folga tinha de sair do shard. A conta não foi feita de cabeça.

**Ferramentas novas (`Setup.gs`):**

- `podarContadores()` — apaga o que está fora da retenção e diz quantas propriedades sobraram.
  **Só toca em chave com prefixo de contador**; configuração, sessão, bloqueio e `media_id` ficam
  onde estão. Trocar uma pane de tela por perda de `ODOO_API_KEY` seria um negócio muito pior, e
  há caso no harness verificando que os dois únicos pontos de exclusão estão dentro das guardas de
  prefixo.
- `listarPropriedades()` — lista tudo por grupo, com valores sensíveis mascarados. Existe porque
  acima de 50 a tela não mostra o resto, e aí não se sabe nem o que está ocupando espaço.
- `verificarProperties()` passou a **avisar a partir de 40** e a explicar a pane acima de 50. O
  sintoma não diz a causa: a pessoa só descobre que não consegue mais editar `ODOO_API_KEY`.

**A chave do Odoo não passa por código.** A saída poderia ter sido uma função que grava
`ODOO_API_KEY` recebendo o valor como argumento — e aí o segredo ficaria digitado num `.gs`, a um
`clasp push` de distância do repositório **público**. `podarContadores()` devolve a tela do
editor, e o segredo continua sendo digitado onde sempre foi.

**Cobertura:** 4 casos no `conta-mensagens.js`, sendo o principal o cálculo do **regime
permanente a partir das constantes** — nada no código dizia esse número, e era o número que
faltava. Três dos quatro reprovam contra o código anterior.

**Ordem de uso:** `clasp push` → `podarContadores()` → recarregar o editor (F5) → editar
`ODOO_UID` e `ODOO_API_KEY` → `testarConexaoOdoo()` → seguir o BL-17.

---

### BL-17 — nota de 24/09: a detecção de administrador dava falso OK

Com `ODOO_UID = 13` conectando e o `testarConexaoOdoo()` verde, faltava rodar
`--aplicar --login=` e depois `--verificar`. Ao reler o script antes disso, apareceu um defeito
no **único aviso que justifica o item inteiro**.

A checagem de "este usuário ainda é administrador?" estava assim:

```js
[['id', 'in', u.groups_id], ['name', 'ilike', 'Settings']]
```

**`res.groups.name` é traduzido.** Num Odoo em português o grupo se chama "Configurações" /
"Administração", e o filtro não casa com nada — o script então **silencia** sobre um usuário que
continua administrador. Não é um erro que apareça como erro: aparece como "está tudo certo",
que é o desfecho pior que não ter checagem nenhuma.

É a **segunda vez** que este script falha assim. A primeira foi o `check_access_rights`, que não
existe mais na `saas-19.3` e teria estourado no primeiro modelo. Os dois casos têm a mesma forma:
o script cujo trabalho é provar que o resto ficou certo não tinha nada provando que ele próprio
estava.

**Correção:** resolver os grupos por **XML ID** via `ir.model.data`, que não é traduzido —
`base.group_system` (Administração → Configurações) e `base.group_erp_manager` (Administração →
Direitos de acesso). O segundo faltava por completo: um usuário só com ele administra direitos de
acesso e passaria batido mesmo em inglês.

E, quando os XML IDs não resolvem, **avisa em vez de calar** — não dá para afirmar que alguém não
é administrador quando a consulta falhou.

**Cobertura:** 5 casos no `conta-mensagens.js`, três deles reprovando contra a versão anterior.
Um detalhe do próprio harness ficou registrado ali: os comentários deste script **citam o código
errado de propósito**, ao explicar por que foi trocado, então a busca por "não pode conter X"
acusava a própria explicação de X. A varredura passou a ignorar comentários — foi ela que pegou
isso, na primeira execução.

**O que continua sendo manual, de propósito:** tirar o usuário de Administração. Tirar acesso por
script tranca alguém para fora quando o login errado é informado, e há caso no harness garantindo
que o script nunca remove ninguém de grupo.

---

### BL-17 — nota de 24/09 (2): o alarme falso do `res.partner`

Com o usuário criado (**Função: Usuário**, não Administrador), o grupo "Meu Dízimo · Bot"
instalado com a matriz correta e 1 usuário dentro, a tela do Odoo mostrava também:
**Direitos de acesso: 127. Regras de registro: 58. Grupos: 4.**

Nosso grupo contribui **9** desses 127. Os outros ~118 vêm do grupo de usuário interno padrão
(`base.group_user`), e é aí que estava o defeito.

**O verificador contava `res.partner` como sobra** e concluía *"provavelmente o usuário ainda é
administrador"*. Isso é falso: `base.group_user` concede escrita em `res.partner`,
`ir.attachment` e `mail.message` a **todo usuário interno** do Odoo. É o piso, não um sinal de
privilégio — e o `--verificar` teria acusado de administrador um usuário corretamente limitado,
logo depois de a tela provar o contrário.

**Alarme falso desgasta o alarme.** Na próxima sobra de verdade, ninguém olha. Por isso a lista
foi partida em duas:

- **Escrita que só administrador deveria ter** — `ir.ui.view`, `ir.cron`, `res.groups`. Exigem
  `base.group_system` ou `base.group_erp_manager`. Aqui, sobra é achado.
- **Piso do usuário interno** — `res.partner`, `ir.attachment`, `mail.message`. Informativo,
  não conta.

`ir.model.fields` saiu da lista de proibidos: já estava na MATRIZ com `write: 0`, e a duplicação
fazia a mesma falha entrar duas vezes no total.

**O residual, dito com todas as letras.** No Odoo, um usuário interno não pode ser mais restrito
que `base.group_user` — a alternativa seria usuário de portal, que não serve para o acesso via
API aos modelos `x_*`. Então o bot **continua alcançando os modelos padrão do Odoo** (contatos,
anexos, mensagens). O que o BL-17 elimina é o poder de administrador: apagar a base, gerenciar
usuários, instalar módulos, ler tudo. É uma redução grande e não é redução total. Baixar do piso
exigiria regras de registro por modelo, que é outro item.

**Cobertura:** mais 2 casos no `conta-mensagens.js`, ambos reprovando contra a versão anterior.

---

### BL-17 — nota de 24/09 (3): o verificador aprovava quando não sabia

O usuário rodou `--verificar` com **um uid que não existe, de propósito**, e o script devolveu um
relatório completo — matriz, FALTA, SOBRA, veredito — contra credencial que nem autenticava. Pior,
na seção de segurança:

```
   res.partner              write:· ok
   ir.ui.view               write:· ok
   ir.cron                  write:· ok
   res.groups               write:· ok
```

**Falha total de autenticação lida como aprovação.** Um dígito errado na chave e a conclusão seria
"o bot está trancado".

O driver de prova mostrou que era pior do que o log sugeria. Quatro defeitos:

| Cenário | Comportamento anterior | Correto |
|---|---|---|
| uid inexistente | **exit 0, ✅ "nada de administrador"** | falhar |
| credencial recusada | exit 1 com diagnóstico falso ("ainda é administrador") | falhar dizendo que é credencial |
| erro de rede | inventava 3 FALTA e 1 SOBRA | dizer "não sei" |
| **usuário ainda administrador** | **exit 0** | falhar |

O último é o mais grave: `process.exit(faltando ? 1 : 0)` **ignorava `sobrando`**. A condição
exata que o BL-17 existe para detectar saía com código zero e passaria em qualquer CI.

**As causas, todas da mesma família:**

1. `rpc()` descartava `error.data.name`, que é onde o Odoo distingue `AccessDenied` (credencial)
   de `AccessError` (permissão). Sem isso, o script adivinhava pelo texto da mensagem — que muda
   com o idioma.
2. `pode()` devolvia a **string** do erro quando não era permissão. String comparada com booleano
   é sempre diferente, então todo "não sei" virava FALTA ou SOBRA.
3. Na lista de administrador, `ok = w !== true` — uma string é `!== true`, logo **"ok"**. A
   checagem de segurança aprovava justamente quando não sabia.
4. O código de saída só olhava `faltando`.

**O que passou a valer:** `rpc()` preserva `odooName`; uma **conferência de credencial** roda
antes de qualquer outra coisa e aborta dizendo se o uid não existe ou se a chave foi recusada,
imprimindo **nome e login de quem conectou** (verificar o usuário errado devolve um relatório
coerente e inútil); `pode()` tem **três estados** — `true`, `false`, `null` —, e `null` nunca é
achado; só `false` aprova na lista de administrador; e o exit code cai com falta, sobra **ou**
indeterminado.

**A lição, que é a quarta repetição da mesma:** este script já errou quatro vezes, sempre para o
lado do "está tudo certo" — `check_access_rights`, o grupo por nome em inglês, o `res.partner` do
piso, e agora estas quatro. **Ler o código não pegou nenhuma delas**; três passaram por revisão.
Por isso agora existe `ferramentas/prova-verificador.mjs`: sobe um Odoo de mentira em localhost,
um por cenário, e roda o verificador de verdade contra ele. Sai 1 se qualquer cenário responder
diferente do esperado. Nada vai para a rede e nenhuma credencial é usada.

**Cobertura:** 5 cenários executáveis na prova, mais 5 casos novos no `conta-mensagens.js` (que
também exige que a prova não seja apagada). Os cinco cenários reprovam contra a versão anterior —
dois deles com exit 0 onde deveria ser 1.

---

### BL-17 — nota de 24/09 (4): a chamada errada, e o mock que a abençoava

O conserto anterior funcionou como devia: o verificador **recusou-se a dar veredito**, imprimiu
39 "NÃO SEI" e saiu com 1. A versão de antes teria dito "16 FALTANDO, 25 SOBRANDO, ainda é
administrador" — acusando um usuário correto por um erro do próprio script.

O que ele expôs:

```
BaseModel.has_access() missing 1 required positional argument: 'operation'
```

**A chamada estava errada.** Em `odoo/api.py`, método que não é `@api.model` é despachado por
`_call_kw_multi`:

```python
ids, args = args[0], args[1:]
recs = model.browse(ids)
result = method(recs, *args, **kwargs)
```

`args[0]` é **sempre** consumido como lista de ids. Mandando `['read']`, o Odoo leu `'read'` como
ids e chamou `has_access(recs)` sem operação. O certo é `[[], 'read']` — recordset vazio
explícito, depois a operação. O comentário que eu tinha escrito ali ("num recordset vazio, que é
o que o execute_kw entrega quando não se passam ids") descrevia um mecanismo que não existe.

**E a prova não pegou, porque o mock errava igual.** O Odoo de mentira lia `args[0]` como a
operação — exatamente o engano de quem chamava. Um mock que repete a suposição de quem chama não
testa a suposição: **ele a confirma**. A prova ficou verde contra código que o Odoo real recusou
39 vezes seguidas.

**Correção dupla:** a chamada virou `[[], op]`, e o mock passou a reproduzir o despacho —
consome `args[0]` como ids e devolve a mensagem real do Odoo quando a forma está errada.
Revertendo só a chamada, a prova agora reprova em 2 cenários. Antes, passava em 5.

**Varredura:** nenhum outro ponto do projeto tem o mesmo problema. Todas as demais chamadas são
CRUD padrão (`read`, `write`, `create`, `unlink`, `search*`), onde `args[0]` já é id ou domínio
por definição. `has_access` era a única com argumento posicional extra.

**Quinta falha do mesmo script, e a primeira em que o próprio script se protegeu.** As quatro
anteriores deram veredito errado; esta parou e disse que não sabia. É a diferença entre um
verificador quebrado e um verificador honesto — e foi o conserto da nota (3) que produziu isso.

**A lição sobre mocks**, que vale além deste item: o mock foi escrito lendo o mesmo trecho de
código que o chamador. Onde os dois compartilham uma suposição, o teste não tem como falhar.
Vale para o fake do Odoo no `conta-mensagens.js` também — ele já mentiu três vezes por motivos
dessa família.

---

### BL-17 — nota de 24/09 (5): a sobra não era administrador

Com a chamada corrigida, o `--verificar` finalmente devolveu a matriz de verdade:

```
   x_devolucao              read:✓  write:✓  create:✓  unlink:·
   x_dizimista              read:✓  write:✓  create:✓  unlink:·
   x_contato_bot            read:✓  write:✓  create:✓  unlink:·
   x_notificacao_log        read:✓  write:✓ SOBRA  create:✓  unlink:·
   x_comunidade             read:✓  write:✓ SOBRA  create:✓ SOBRA  unlink:·
   x_parametros             read:✓  write:✓ SOBRA  create:✓ SOBRA  unlink:·
   x_parametros_line_c498a  read:✓  write:✓ SOBRA  create:✓ SOBRA  unlink:·
   ir.model.fields          read:✓  write:·  create:·  unlink:·
   res.users                read:✓  write:✓ SOBRA  create:·  unlink:·
```

**Oito sobras reais** — e a mensagem final dizia *"o usuário ainda tem poder de administrador"*,
**contradizendo a própria saída do comando**, que mostrava `ir.ui.view`, `ir.cron` e `res.groups`
todos em `· ok`. A tela do Odoo confirma: Função = Usuário, e os 4 grupos são Todos, Usuário,
Meu Dízimo · Bot e Procedimentos técnicos. Nenhum é Administração.

**A causa real: ACLs do Odoo são ADITIVAS.** Criar um grupo restritivo não anula uma regra
permissiva já existente. O Studio cria uma `ir.model.access` junto com cada modelo `x_*`, valendo
para todo usuário interno — e é ela que concede a escrita. O grupo "Meu Dízimo · Bot" soma,
nunca subtrai.

Mandar a pessoa procurar em Administração quando o problema está em `ir.model.access` custa uma
tarde. **Dois contadores separados agora:**

| | O que é | O que fazer |
|---|---|---|
| `sobraDeAdmin` | escrita em `ir.ui.view` / `ir.cron` / `res.groups` | tirar de Administração |
| `sobraNoBot` | escrita a mais nos `x_*` | achar a `ir.model.access` permissiva |

**Modo `--explicar` (novo), rodado com a chave do administrador:** lista, por modelo, cada regra
de `ir.model.access`, o grupo dela e o que concede a mais — marcando 🚨 só quando o bot pertence
àquele grupo (ou quando a regra não tem grupo, valendo para todos).

Uma armadilha evitada ali: `ir.model.access.model_id` volta como `[id, rótulo AMIGÁVEL]`
("Devolução"), não o nome técnico. Agrupar pelo rótulo casaria com nada — é a mesma armadilha do
grupo de administrador buscado por nome. O modo resolve o nome técnico via `ir.model`, e há caso
no harness exigindo isso.

**O que o `--explicar` NÃO faz, de propósito:** apagar as regras. Elas existem provavelmente para
os agentes da pastoral, que editam comunidade e parâmetros pela tela. Apagá-las tranca as pessoas
para fora. O caminho é restringir a regra a um grupo de quem usa a tela e deixar o bot fora dele —
decisão sobre quem pode o quê na paróquia, não coisa de script.

**Risco concreto enquanto isso não fecha:** `x_comunidade` com escrita significa que a **chave PIX
da paróquia é gravável pelo bot**. Quem obtiver a chave de API poderia redirecionar doações. É
bem menor que o risco de administrador (apagar a base, gerenciar usuários), mas é o que resta.

**Cobertura:** cenário novo `sobra-no-bot` na prova executável — o caso real, em que os modelos do
bot sobram e os de administrador estão limpos —, mais 3 casos no `conta-mensagens.js`. A prova
passou de 5 para 6 cenários, e a contagem na mensagem final passou a sair da lista em vez de um
literal, que já estava desatualizado.

---

### BL-17 — nota de 24/09 (6): `groups_id` não existe mais

O `--explicar` estourou na primeira consulta:

```
Error: Invalid field 'groups_id' on 'res.users'   (builtins.ValueError)
```

Conferido no código-fonte da versão fixada (`odoo/addons/base/models/res_users.py:248-250`,
tag `saas-19.3`):

```python
group_ids     = fields.Many2many('res.groups', ..., help="Groups explicitly assigned")
all_group_ids = fields.Many2many('res.groups', string="Groups and implied groups",
                                 compute='_compute_all_group_ids')
```

`groups_id` virou **`group_ids`**, e ganhou um irmão: **`all_group_ids`**, com os grupos
implicados.

**A distinção não é cosmética.** Grupos do Odoo implicam outros. Quem está num grupo que implica
`base.group_system` é administrador **sem ter `group_system` na lista explícita** — e uma
`ir.model.access` num grupo implicado também alcança o usuário. Olhar só os explícitos deixaria
passar exatamente os casos que interessam. Então:

| Uso | Campo |
|---|---|
| "é administrador?" | `all_group_ids` |
| "esta ACL alcança o bot?" | `all_group_ids` |
| "pôr no grupo" | `group_ids` (o gravável; o outro é computed) |

**Sétimo uso, dois modos quebrados.** O campo morto aparecia 7 vezes, em `--explicar` **e** em
`--aplicar --login=`. O segundo é o que põe o bot no grupo — o que explica por que o usuário
precisou fazer isso à mão na tela do Odoo.

**Por que a prova não pegou: ela cobria só `--verificar`.** Um terço do script. Duas correções
estruturais:

1. **O mock passou a validar nomes de campo** contra os que existem de verdade na `saas-19.3`, e
   devolve `ValueError: Invalid field 'x' on 'y'` como o Odoo. Revertendo para `groups_id`, a
   prova agora reprova em 2 cenários.
2. **Dois cenários novos para `--explicar`** — `explicar-limpo` (nenhuma regra concede a mais,
   exit 0) e `explicar-culpado` (a regra sem grupo, do Studio, exit 1 nomeando-a). O mock
   devolve `model_id` com um rótulo **propositalmente diferente** do nome técnico, para que a
   resolução via `ir.model` seja realmente exercitada.

**A sexta falha desta família, e a primeira com defesa automática.** As seis foram todas a mesma
coisa: nome de API do Odoo escrito de memória em vez de conferido na versão fixada —
`check_access_rights`, grupo por nome traduzido, `res.partner` do piso, a forma de `has_access`,
o exit code, e agora `groups_id`. O padrão é claro, e o antídoto é o que já existe para o py_js
(`provar-dominio-filtro.mjs`): **baixar a fonte da tag e conferir, em vez de lembrar.**

**Cobertura:** a prova foi de 6 para **8 cenários** e passou a exercitar dois modos em vez de um;
mais 4 casos no `conta-mensagens.js`.

---

### BL-17 — nota de 24/09 (7): o `--explicar` respondeu, e uma das 5 é intocável

O diagnóstico saiu limpo: **todas as 5 sobras vinham de um grupo só**, `base.group_user`
("Role / User"), o grupo de qualquer usuário interno.

```
🚨 Notificaçao Log group_user   →  A MAIS: write
🚨 Comunidade group_user        →  A MAIS: write, create
🚨 Parâmetros group_user        →  A MAIS: write, create
🚨 parametros_line group_user   →  A MAIS: write, create
🚨 res_users all (Role / User)  →  A MAIS: write
```

**A quinta não é do Studio — é do Odoo.** Conferido em
`odoo/addons/base/security/ir.model.access.csv` da tag `saas-19.3`:

```
"access_res_users_employee","res_users all","model_res_users","base.group_user",1,1,0,0
```

Write em `res.users` para todo `base.group_user` é de fábrica, e é o que permite a cada pessoa
editar as próprias preferências (idioma, fuso, assinatura). Tirar quebraria todos os usuários
internos, e o Odoo restauraria na próxima atualização.

**A matriz estava pedindo o impossível.** `res.users: write 0` gerava um achado que ninguém pode
resolver — o mesmo erro do `res.partner` da nota (2), repetido. Agora a matriz aceita `null` para
"piso do Odoo, não se opina", distinto de `0` ("não pode, e poder é achado"), e a linha do
`res.users` usa `null`.

**As outras quatro são do Studio e saem.** E dá para vê-lo pelo próprio relatório: a paróquia já
tem papéis de verdade — `Pastoral do Dízimo / Acesso Comunidade`, `Pastoral do Dízimo / Secretaria
Paroquial`, `Role / Administrator` — e a Secretaria já tem `read, write, create` em Comunidade e
Parâmetros pela regra dela. A regra de `group_user` é **redundante para quem tem papel** e
permissiva para quem não tem.

**Modo `--restringir` (novo), com duas travas**, porque isto altera a permissão de **todos os
usuários internos**, não só do bot:

1. **Só toca em modelo `x_*`.** Os do Odoo (`res.users`, `ir.model.fields`) ficam fora por
   construção — exatamente o caso acima.
2. **Só toca em regra cujo grupo é `base.group_user`**, resolvido por XML ID. As da Secretaria,
   da Pastoral e do Administrador não são tocadas: são elas que mantêm as pessoas trabalhando.

Simula por padrão. Há caso na prova afirmando que **nenhuma escrita sai sem `--aplicar`** — não
basta o texto dizer que simulou, o mock registra as gravações e o cenário exige zero.

**Depois de aplicar, o estado esperado:** quem tem papel continua com o que o papel dá; quem é só
usuário interno passa a ler e não escrever nos modelos do dízimo; o bot fica na matriz.

**Cobertura:** a prova foi de 8 para **10 cenários**, cobrindo agora três modos (`--verificar`,
`--explicar`, `--restringir`); mais 5 casos no `conta-mensagens.js`.

---

### BL-17 — nota de 24/09 (8): restringir podia trancar a Secretaria

A simulação do `--restringir` saiu correta — 4 regras a alterar, as 3 que o bot legitimamente
precisa intocadas, e `res_users all` **ausente da lista**, provando que a trava de "só modelo
`x_*`" funcionou.

Mas comparando com o relatório do `--explicar`, faltava uma pergunta:

| Modelo | Regra de escrita fora de `group_user` |
|---|---|
| `x_comunidade` | ✅ `Secretaria - Comunidade` |
| `x_parametros` | ✅ `Secretaria - Parâmetros` |
| **`x_parametros_line_c498a`** | ❌ **nenhuma** |
| `x_notificacao_log` | ❌ nenhuma (mas ninguém edita log à mão) |

**A Secretaria edita as linhas de parâmetro hoje pela regra de `base.group_user`.** Tirando-a,
só o Administrador escreve nelas — e o sintoma aparece quando alguém tenta salvar, não na hora
de aplicar. Um script que faz uma mudança de permissão sem dizer isso empurra o custo para a
pessoa errada, num momento pior.

**O `--restringir` passou a avisar.** Para cada regra que perde `write`, ele pergunta se resta
alguma outra regra de escrita **que não seja do administrador nem do próprio grupo do bot**. Se
não restar, lista o modelo sob um aviso explícito e sugere criar antes a regra do grupo de quem
usa a tela, espelhando a do modelo "pai".

**A verificação que faltava na prova, e que quase passou despercebida:** o cenário órfão prova
que o aviso *aparece*, mas não que ele *discrimina*. Um aviso disparando sempre passaria nos
dois. Por isso o cenário com Secretaria ganhou uma **assertiva negativa** — ele reprova se o
aviso aparecer. Conferido forçando `orfaos.push(model)` incondicional: reprova, como deve.

**Cobertura:** a prova foi de 10 para **11 cenários**; mais 2 casos no `conta-mensagens.js`, que
chegou a 265 verificações.

---

### BL-76 — Parâmetros, notificações e contato do bot só para o Administrador 📋 (P)

**Decisão do usuário (24/09):** *"Quero manter os acessos de parametros, notificações e contato
bot somente com o perfil admin. Mas isso pode ser feito depois."*

**Por que é um item separado do BL-17.** O BL-17 trata do que o **bot** pode fazer. Este trata do
que as **pessoas** podem fazer. Os dois se cruzam nas mesmas regras de `ir.model.access`, mas são
perguntas diferentes e com riscos diferentes: errar no BL-17 deixa uma chave de API poderosa
demais; errar aqui tranca um agente da pastoral para fora do trabalho dele.

**Estado atual**, do relatório do `--explicar` de 24/09:

| Modelo | Bot | Administrador | Secretaria | Acesso Comunidade | `Role / User` |
|---|---|---|---|---|---|
| `x_parametros` | read | tudo | read, write, create | read | read, write, create |
| `x_parametros_line_c498a` | read | tudo | — | — | read, write, create |
| `x_notificacao_log` | read, create | tudo | — | — | read, write, create |
| `x_contato_bot` | read, write, create | tudo | — | — | read, write, create |

**O alvo:** nas quatro linhas, sobrar **apenas o grupo do bot e o Administrador**.

**O que precisa mudar** (a confirmar na tela antes de aplicar):

1. Apagar, ou zerar, as regras de `Role / User` (`base.group_user`) nos quatro modelos.
   O bot não perde nada: ele tem regra própria em todos.
2. Em `x_parametros`, apagar também `Secretaria - Parâmetros` e `Comunidade - Parâmetros` — são
   elas que hoje dão acesso à Secretaria e à Pastoral.
3. Conferir com quem usa: **alguém da Secretaria edita parâmetros hoje?** Se sim, esta decisão
   transfere essa tarefa para o Administrador, e isso é escolha da paróquia, não consequência
   técnica.

**Relação com o `--restringir` do BL-17.** Aquele modo tira só `write`/`create` de `group_user`,
deixando `read`, e só nos modelos onde a matriz do bot pede menos. Ele **não fecha este item** —
aqui o alvo inclui tirar o `read` e mexer nas regras da Secretaria, que o `--restringir` não toca
de propósito.

Uma consequência boa: com esta decisão registrada, o aviso *"depois disto, SÓ O ADMINISTRADOR
escreve em x_parametros_line_c498a"* que o `--restringir` emite deixa de ser um impedimento e
passa a ser o resultado desejado.

**O que NÃO entra aqui:** `x_comunidade`. A Secretaria precisa editar comunidade (chave PIX,
titular, endereço) e continua com a regra dela. `x_devolucao` e `x_dizimista` idem — são o
trabalho diário da pastoral.

---

### BL-17 — nota de 24/09 (9): "Nada foi alterado" era promessa por sorte

O `--restringir --aplicar` morreu em `UND_ERR_CONNECT_TIMEOUT` e imprimiu *"Isso é CONEXÃO, não
credencial. Nada foi alterado."* **Desta vez era verdade** — a queda veio na primeira chamada,
antes de qualquer gravação, e o `--verificar` seguinte confirmou as mesmas 7 sobras.

Mas a frase saía do tratador de erro do `rpc()`, ou seja **de qualquer ponto do código**. O
`--restringir --aplicar` grava num laço, uma regra por vez. Um timeout na terceira de quatro
deixaria duas regras já gravadas — e o script juraria que nada mudou, mandando a pessoa confiar
num estado pela metade.

Promessa que só vale por sorte não é promessa.

**Agora o `rpc()` registra o que já gravou** (`create`, `write`, `unlink`) e a mensagem de queda
diz a verdade dos dois lados: "nada foi alterado, a falha veio antes de qualquer gravação" ou
"⚠️ N gravações JÁ FORAM FEITAS", listando-as.

**Não tenta desfazer, de propósito.** Reverter exigiria conhecer o valor anterior de cada campo,
e tentar isso pela mesma rede que acabou de cair transforma um problema em dois. Em vez disso
aponta a saída real: **os modos são idempotentes** — rodar de novo mostra o que já foi aplicado
como "já está certo" e grava só o que falta.

**Cobertura:** cenário `queda-no-meio` na prova, com o mock derrubando o socket **depois** da
primeira gravação e o cenário exigindo que a saída **não** contenha "Nada foi alterado". Com a
mensagem antiga, reprova. A prova foi de 11 para **12 cenários**.

**De passagem, duas coisas que o log confirmou funcionando:** o aviso *"confira se é MESMO o
usuário do bot"* pegou uma execução feita com a chave do administrador ainda no `.odoo-env` — o
relatório saiu coerente e completamente inútil, e a linha com nome e login foi o que denunciou.
E `res.users write` aparece como `~ piso` em vez de achado, conforme a nota (7): as sobras caíram
de 8 para 7 sem que nada no Odoo mudasse.

---

### BL-17 — FECHADO (24/09)

```
   x_devolucao              read:✓  write:✓  create:✓  unlink:·
   x_dizimista              read:✓  write:✓  create:✓  unlink:·
   x_contato_bot            read:✓  write:✓  create:✓  unlink:·
   x_notificacao_log        read:✓  write:·  create:✓  unlink:·
   x_comunidade             read:✓  write:·  create:·  unlink:·
   x_parametros             read:✓  write:·  create:·  unlink:·
   x_parametros_line_c498a  read:✓  write:·  create:·  unlink:·
   ir.model.fields          read:✓  write:·  create:·  unlink:·
   res.users                read:✓  write:~ piso  create:·  unlink:·

   ir.ui.view  · ok      ir.cron  · ok      res.groups  · ok

✅ Exatamente o que o código usa nos modelos do bot, e nada de administrador.
```

**O que mudou de verdade:** a chave de API do bot deixou de valer o ERP inteiro. Antes, quem a
obtivesse — um script exposto, uma conta Google comprometida, alguém com acesso ao editor do Apps
Script — podia apagar ou exportar a base da paróquia, criar usuários e instalar módulos. Agora
alcança nove modelos, sem `unlink` em nenhum.

**O residual, dito com todas as letras:** o bot continua alcançando `res.partner`,
`ir.attachment` e `mail.message` com escrita, porque é o piso de `base.group_user` e um usuário
interno não pode ser mais restrito que isso. Baixar dali exigiria regras de registro por modelo,
ou um usuário de portal — que não serve para acesso via API aos modelos `x_*`.

**O que este item custou, e por quê vale registrar.** Nove notas de correção, todas do
**verificador**, não do que ele verificava. As seis primeiras foram a mesma coisa: nome de API do
Odoo escrito de memória em vez de conferido na versão fixada. As três últimas foram mensagens
confiantes e erradas — "ainda é administrador" quando não era, "nada foi alterado" sem saber.

O padrão só quebrou quando o script passou a **falhar em vez de concluir**: a nota (4) fez ele
dizer "NÃO SEI" e sair com 1, e foi essa recusa que expôs o bug real da chamada. Um verificador
que aprova quando não sabe é pior que verificador nenhum — ele encerra a investigação.

Ficou `ferramentas/prova-verificador.mjs`, com **12 cenários** executáveis contra um Odoo de
mentira, cobrindo três modos. Ler o código não pegou nenhuma das nove; três passaram por revisão.

---

### BL-17 — nota final: a metade que o `--verificar` não prova

Com o `--verificar` limpo, restava uma pergunta que ele **não responde**: ele prova que as
permissões batem com a MATRIZ, não que a matriz cobre o que o código usa. São coisas diferentes,
e a segunda é a que quebra em produção.

**E quebra sem janela.** `ODOO_UID` e `ODOO_API_KEY` são lidos das Script Properties **a cada
execução** — a troca do usuário valeu no instante em que foi salva no editor, sem `clasp push`.
Uma matriz incompleta derruba o bot antes de qualquer deploy, e o sintoma é um `AccessError` num
caminho que ninguém percorre até alguém reclamar.

**Varredura feita:** todo modelo Odoo citado no código foi comparado com a matriz. Dois ficavam
de fora:

| Modelo | Situação |
|---|---|
| `ir.model` | só em `SetupCamposFamilia.gs` e `SetupCamposOferta.gs`, funções manuais do editor que criam schema e rodam com credencial de administrador — já excluídas de propósito na MATRIZ |
| `x_parametros_line` | **modelo que não existe no Odoo** (o real é `x_parametros_line_c498a`) |

**O segundo virou limpeza.** `OdooService.buscarParametro(chave)` consultava `x_parametros_line`
e era chamado só por `TesteNotificacao.gs`, que está no `.claspignore`. Em produção, código morto
apontando para um modelo inexistente. Removido.

Os dois usos no teste passaram a ler a **Script Property `NOTIFICACOES_ATIVAS`**, que é o
interruptor que a produção realmente usa. Antes o teste dizia "não configurado" para todo mundo,
sempre — a consulta falhava em silêncio dentro de um `try/catch` e ninguém notava. Um teste que
sempre dá a mesma resposta não testa nada.

**Virou verificação permanente.** O `conta-mensagens.js` passou a cruzar as chamadas
`OdooService.*`/`this.*` de todo `.gs` que vai ao deploy contra a MATRIZ, e reprova se aparecer
modelo não coberto. Também avisa (sem reprovar) sobre permissão concedida a modelo sem uso.

Um detalhe do próprio guarda, encontrado ao escrevê-lo: a primeira versão só casava
`OdooService.metodo('modelo'` numa linha, e dentro do `OdooService.gs` as chamadas são `this.` com
o nome do modelo **na linha seguinte**. Ele acusou três modelos usados o tempo todo de estarem
"sem uso". Corrigido antes de entrar.

**O que continua sem prova, e só um teste real fecha:** as **regras de registro** (a instância tem
58). Elas filtram QUAIS REGISTROS um usuário alcança, e `has_access` responde pelo MODELO, não
pela linha. O bot pode ter permissão em `x_dizimista` e uma regra de registro limitá-lo a zero
registros. Mandar uma mensagem ao bot e fazer uma devolução cobre isso e o resto.

---

## Revisão de código de 24/09/2026

Revisão dos `.gs` de produção feita junto com a análise de escopo da migração (BL-74). Os itens
BL-77 a BL-83 foram **conferidos linha a linha**; o BL-84 reúne o que os revisores apontaram e
ainda precisa de conferência antes de virar correção. Detalhes e contexto em
[notas.md](notas.md).

Nenhum depende da migração: valem para o Apps Script de hoje.

**Corrigidos em 24/09** (BL-77 a BL-83), um commit por item. Cada conserto tem caso no
`conta-mensagens.js` que **reprova no código anterior** — conferido um a um. O BL-82 era pior
que o registrado: sem rótulo, um valor sem separador de milhar não era lido de jeito nenhum.

### BL-77 — Dízimo gravado como oferta 🔴 (P)

**Arquivos:** `OfertaHandler.gs:58-65`, `ComprovanteHandler.gs:774`, `MenuHandler.gs`,
`DevolucaoHandler.gs`

**O problema.** Quando o dizimista toca em *Oferta*, `OfertaHandler.iniciar` já grava
`ofertaComunidadeId`, `ofertaComunidadeNome`, `ofertaNome` e `ofertaDizimistaId` na sessão —
antes de ele escolher qualquer coisa. Nada limpa esses campos: `menuPrincipal`, `menuDizimista`
e `iniciarDevolucao` só trocam o estado. E o `ComprovanteHandler` decide o caminho **só pela
presença** de `ofertaComunidadeId`.

**Cenário.** Toca em Oferta → desiste → toca em Dízimo → manda o comprovante. A devolução é
gravada com `tipo='oferta'`, some do relatório de dízimo, e a pessoa lê "Oferta recebida".
Dado financeiro errado, em silêncio.

**Proposta.** Limpar os quatro campos `oferta*` ao entrar em `iniciarDevolucao` e no menu. Mais
robusto ainda: decidir o caminho pelo **estado** da conversa, não pela sobra de um campo.

**Aceite.** Caso novo no `conta-mensagens.js`: Oferta → Menu → Dízimo → comprovante grava
`tipo='dizimo'`.

### BL-78 — Deduplicação do webhook curta e não atômica 🔴 (P)

**Arquivo:** `Webhook.gs:316-322`

**O problema.** A chave `msg_<id>` vive 600 s, e o `CacheService` pode descartá-la antes. A Meta
reentrega o webhook por horas quando não recebe resposta a tempo — e as execuções medidas levam
10 a 24 s. Uma reentrega depois de 10 min é processada de novo; se a mensagem era um comprovante,
`registrarDevolucao` faz um segundo `create`. Além disso o `get` → `put` não é atômico: duas
entregas simultâneas passam juntas pelo filtro.

**Proposta.** TTL de 6 h (o máximo do cache). Para o caso simultâneo, o BL-74 Fase 3 resolve de
vez (nome de tarefa determinístico no Cloud Tasks); até lá, aceitar o risco residual e registrar.

### BL-79 — Reação, figurinha ou áudio zeram a conversa 🟠 (P)

**Arquivo:** `Router.gs:32-35`

**O problema.** `reaction`, `sticker`, `audio`, `location`, `contacts`, `unsupported` e `system`
caem no `default`, que chama `MenuHandler.menuPrincipal` → `setEstado(MENU)` e envia um menu
(mensagem cobrada). Um 👍 no meio do cadastro, ou logo antes de mandar o comprovante, desfaz o
estado; a foto seguinte recebe "Não estou esperando uma imagem".

**Proposta.** `reaction` → ignorar. Demais tipos → aviso curto ("ainda não entendo áudio…")
**sem mexer no estado**. Subtipo `interactive` desconhecido hoje é descartado sem resposta —
tratar igual.

### BL-80 — Código de acesso ao relatório no log 🟠 (P)

**Arquivo:** `Router.gs:324`

**O problema.** `console.log(\`💬 Texto: "${texto}" | Estado: ${estado}\`)` registra toda
mensagem de texto, inclusive em `AGUARDANDO_CODIGO_RELATORIO` — anulando o cuidado de
`RelatorioHandler.gs:222`, que diz para não logar a senha. Também vão para o log endereço, data de
nascimento e valores digitados no cadastro por conversa.

**Proposta.** Logar tamanho e estado, não o conteúdo; ou mascarar nos estados sensíveis.

### BL-81 — A baixa age sobre a pendente errada 🟠 (M)

**Arquivo:** `RelatorioHandler.gs:987-1049` (e `processarSelecaoPendente`, `:853-883`)

**O problema.** Os botões `btn_confirmar_baixa`/`btn_rejeitar_baixa` têm id fixo; a devolução
alvo vem de `pendente_devolucao_id` na sessão, que é sobrescrito a cada pendente aberta.

**Cenário.** O coordenador abre A, depois B, rola a conversa e toca "Confirmar" na mensagem de A.
Quem é confirmada é **B**. A baixa também não confere se o status ainda é Pendente (outra pessoa
pode ter rejeitado pelo Odoo), e `processarSelecaoPendente` não confere se a comunidade da
devolução está no acesso daquele coordenador.

**Proposta.** Id do botão carrega a devolução (`btn_confirmar_baixa_<id>`); ao confirmar,
reler e exigir status Pendente e comunidade dentro do acesso.

### BL-82 — OCR corta valor sem separador de milhar 🟠 (P)

**Arquivo:** `VisionService.gs:231-232` (e o caminho alternativo em `:249`)

**O problema.** `\d{1,3}(?:\.\d{3})*(?:,\d{2})?` não tem delimitador no fim. "Valor: R$ 1234,56"
casa só `123`; "R$ 10000,00" vira `100`. O BL-69 marca "Não confere" em várias situações, mas não
nesta: o valor lido é plausível.

**Proposta.** Aceitar `\d{1,3}(?:\.\d{3})+|\d+` antes da vírgula e ancorar com `(?![\d.,])`.
Casos no harness com e sem separador.

### BL-83 — Primeiro contato em hora local num campo `datetime` 🟡 (P)

**Arquivo:** `OdooService.gs:1244`

**O problema.** `x_studio_data_primeiro_contato` é `datetime`; o Odoo interpreta o valor recebido
como **UTC**. O código grava `formatDate(..., 'America/Sao_Paulo', ...)`, então a tela mostra 3 h
a menos, e contatos depois das 21h aparecem no dia anterior.

**Proposta.** Formatar em `'UTC'`. Mesma família do BL-01 (campo `date` com formato errado).

### BL-84 — Achados da revisão, conferidos e corrigidos ✅ (G)

Os achados que os revisores apontaram e eu não tinha conferido. **Todos se confirmaram** ao ler o
código. Cada correção tem caso no `conta-mensagens.js` que **reprova no código anterior**,
conferido um a um; um commit por grupo na branch `fix/bl-84`.

| Achado | Correção |
|---|---|
| `parseValorBR` colava números ("100 ou 200" → 100200), sem teto | Um número por texto; dois é ambiguidade (pede de novo). Teto de R$ 100 mil |
| Dois comprovantes seguidos gravavam duas devoluções | Um comprovante por vez, por pessoa (marca no cache, conferida sob a trava); o segundo ouve "ainda estou analisando" |
| Timeout **depois** do `create` pedia reenvio — e duplicava | Antes de dizer "não foi registrado", pergunta ao Odoo se a devolução acabou de ser criada |
| `criarMembro` sem guarda contra toque duplo | Sob a trava, confere o familiar pelo nome completo na família; achando, devolve o mesmo id |
| Oferta ou devolução Rejeitada calava o lembrete de dízimo | "Já devolveu" conta só dízimo e ignora Rejeitado |
| Número com erro permanente ocupava o lote para sempre | Duas falhas no mês encerram as tentativas daquela pessoa |
| Envio sem log no Odoo era repetido no degrau seguinte | Marca no cache logo após o envio + gravação do log com 3 tentativas |
| Lote até 200 × 2 s passava do teto de 6 min | Orçamento de 4,5 min no laço; o resto sai pela repescagem |
| Consolidado somava devoluções Rejeitadas | Rejeitadas fora de todo total; Pendentes ficam, mas aparecem à parte como "a validar" |
| Despejo do cache apagava cadastro em andamento | A marca de início vive 2 h (o dobro da sessão); sumiu com a conversa ativa = despejo, recomeça a contagem. O limite de 60 min, com aviso, segue valendo |
| Aviso de expiração saía em dobro | A marca "já avisei" vai antes das chamadas ao Odoo |
| Limite de taxa da Meta (HTTP 400) não era repetido | Códigos 4, 80007, 130429 e 131056 repetem como o 429 |
| Nome e telefone de quem oferta no log | O log da devolução leva só o que serve ao diagnóstico; o do lembrete, sem telefone |
| Flow aceitava comunidade inexistente | Recusada no cadastro e na oferta; nome da oferta com teto de 60 |
| "menu" no código de acesso contava como tentativa errada | Sai, sem mexer no contador; vale também no mês personalizado |
| Admin só via 10 comunidades | Listas paginadas — e a da **oferta** cortava em 9, o que ninguém tinha visto. Hoje são 6: era latente |
| Código PIX enviado a `api.qrserver.com` | A reserva do card manda dados + copia e cola, sem imagem: a chave pode ser CPF de pessoa física |
| Documento qualquer com `sha256` virava "imagem" | Só vale como pista sem tipo declarado; o motivo técnico da falha sai da tela |

**Adiado, de propósito:** a trava global do Apps Script, segurada durante chamadas ao Odoo, faz o
`_comLock` desistir sob carga. É estrutural: o Apps Script só tem uma trava para tudo. Aumentar a
espera atrasaria todo mundo. A Fase 3 do BL-74 resolve com trava por usuário no Redis — e a
`Plataforma.trava` já pede as chaves por usuário.

**Conferido e descartado:** o `flow_token` com o número de outra pessoa. Os dados são sempre
gravados na sessão do remetente autenticado pela Meta, nunca no número do token.

**Fica registrado para depois:** o número do WhatsApp (`from`) continua nos logs. É o
identificador operacional de tudo, e mascará-lo cegaria o diagnóstico.

### BL-85 — Texto enquanto o bot espera o comprovante ✅ (P)

**Arquivo:** `Router.gs` (switch de `_rotearTexto`)

**Achado no teste real de 24/09**, validando o BL-79. Depois dos dados de pagamento, o 👍 foi
**enviado** como mensagem — não como reação. Um emoji sozinho é **texto** para o WhatsApp, e
texto em `AGUARDANDO_COMPROVANTE` (ou `_FAMILIA`, `_OFERTA`) caía no `default` do Router →
menu → estado MENU. O comprovante seguinte ouviu "Não estou esperando uma imagem". O mesmo vale
para "já paguei", "ok", "enviando".

**Correção.** Nos três estados de espera de comprovante, texto recebe um lembrete com botão Menu,
e o estado fica onde estava. "menu" continua saindo pelo atalho de sempre.

**Aceite.** Caso no `conta-mensagens.js` (três estados × "👍" e "já paguei") — reprova no código
anterior.

### BL-86 — A frase do comprovante antigo acusa o dado errado 🟡 (P) · 📋 aberto

**Arquivo:** `ComprovanteHandler.gs` (`_fraseDesfecho`)

**Achado no teste do corte (25/09).** Um comprovante de 06/07 (81 dias) foi marcado
`comprovante_antigo` pelo BL-69 — certo. Mas `_fraseDesfecho` tem **uma frase para todo alerta**:
"Os dados de quem recebeu, acima, não batem com os da sua comunidade". Nome e chave conferiam; a
pessoa lê que errou o destinatário quando o problema é a data.

**Correção.** Frase por motivo: `comprovante_antigo` diz a data lida e o limite ("este comprovante
é de 06/07/2026, há mais de 60 dias — se for de um pagamento novo, envie o comprovante dele");
`comprovante_futuro`, a sua; chave e nome/banco divergentes ficam com a de hoje.

**Aceite.** Caso no `conta-mensagens.js` que reprova com a frase atual.

### BL-87 — Inteiro vazio do Odoo chega como 0 🟠 (P) · ⚠️ contido

**Arquivo:** `NotificacaoHandler.gs` (`lerEscalonamentoNotificacao`)

**Achado em 26/09**, ao criar os campos do BL-73. O Odoo devolve **0** para um inteiro vazio — não
`false`. O código trata como "vazio" só `undefined/null/false/''`, e **0 é hora inicial válida**
(faixa 0..23): a janela virava 0h–17h. Com o intervalo (0 → fora da faixa → 2), os disparos
seriam 0h, 2h, 4h … 16h — **lembrete de madrugada** e nunca às 9h. Hora final, intervalo e lote
em 0 caem no padrão por estarem fora da faixa; só a hora inicial escapa.

**Contido:** os quatro campos foram preenchidos (9, 17, 2, 20). Volta a morder se alguém apagar a
hora inicial.

**Correção.** Tratar 0 como vazio nos quatro campos (a janela a partir da meia-noite não é caso de
uso), ou mudar a faixa da hora inicial para 1..23. O mesmo vale conferir em `x_studio_meses_*` e
`x_studio_dias_comprovante` (hoje 0 → padrão, por estarem fora da faixa — por sorte, não por regra).

**Aceite.** Caso no `conta-mensagens.js` com `x_studio_notif_hora_inicio: 0` → janela 9h–17h.

### BL-88 — Parâmetros do BL-73 e do BL-69 no Odoo ✅ (P)

Os quatro campos `x_studio_notif_*` **não existiam** — o bot rodava no padrão do código. Criados
pelo dono em 26/09. Na view Studio de `x_parametros` (id 615): seções **Lembretes no WhatsApp** e
**Comprovantes** (`x_studio_dias_comprovante`, que existia mas não estava na tela), cada uma com
nota explicativa em linha inteira (`colspan="2"` — sem isso a nota ocupa a célula do rótulo e
desalinha os valores; a nota de Classificação tinha esse defeito e foi corrigida junto). Botões
**Novo / Excluir / Duplicar** desligados no formulário: há um único registro, e um segundo faria o
bot ler o errado. O menu **Parâmetros** (ação 210) abre direto o registro 1, sem a lista.
