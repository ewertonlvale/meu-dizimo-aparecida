# Especificação — Gestão de Família (dízimo familiar)

**Criado em:** 14/09/2026 · **Revisado em:** 15/09/2026
**Status:** proposta (aguardando Fase 0 no Odoo para implementar a Fase 1)

## Conceito

Uma **família** é um dizimista **responsável** e os **membros** vinculados a ele. O responsável (quem tem o WhatsApp/cadastro) pode **adicionar membros** e **devolver o dízimo** de um, de vários ou de todos de uma vez — com **um único PIX e um comprovante**, gerando **uma devolução por membro**.

O ponto de entrada é a mensagem que já aparece quando o número está cadastrado (não há tela separada de "gestão de família").

## Decisões (aprovadas)

1. **Vínculo:** campo dedicado **`x_dizimista.x_studio_responsavel`** (many2one → `x_dizimista`). Membros apontam para o responsável. Responsável = dizimista com `x_studio_responsavel` vazio. *(Escolhido em vez de "número compartilhado" porque `x_studio_partner_phone` é related de um `res.partner` — compartilhar entrelaçaria parceiros e pioraria o BL-15.)*
2. **Comunidade:** membros herdam a do responsável → uma única chave PIX; um pagamento cobre a família.
3. **Valores:** cada devolução usa o **valor mensal cadastrado** do membro; o total é a soma dos selecionados.
4. **UI de seleção (Opção B — botão até caber, senão lista):** ≤3 opções → botões (1 toque); mais que isso → lista (máx. 10 linhas, seleção única). A maioria das famílias tem ≤2 membros → caso comum usa botões.
5. **Cadastro do membro:** **completo** (dados pessoais), porém **sem** telefone (membro não fala com o bot), **sem** seleção de comunidade (herdada) e **sem** notificações.
6. **Histórico:** individual (sem visão de família). 1 cadastro → direto; 2+ → pergunta de quem (botões até 3; lista a partir de 4) e mostra o individual.

## Modelo de dados (Odoo)

- **`x_dizimista.x_studio_responsavel`** (many2one → `x_dizimista`) — **criar (Fase 0)**. É o vínculo da família.
- **`x_devolucao.x_studio_grupo_pagamento`** (char/texto) — *recomendado (Fase 2)*: mesmo id/uuid nas N devoluções de um pagamento, para o coordenador ver que vieram juntas.
- Membros ficam **sem telefone** (`x_studio_partner_phone` vazio) — só o responsável tem número.

## Como identificar a família (no código)

- **Responsável:** `buscarDizimistaPorWhatsapp(phone)` → o dizimista com aquele número (o que já acontece hoje).
- **Membros:** `searchRead('x_dizimista', [['x_studio_responsavel','=', responsavel.id]])`.
- **Família (para devolver):** `[responsável] + membros`.
- Membros não têm telefone, então não aparecem como usuários independentes numa busca por número — são geridos pelo responsável.

## Fluxos (WhatsApp)

### 1. Ponto de entrada — mensagem de "já cadastrado"
Quando o número já tem cadastro e o usuário toca "Ser Dizimista", a mensagem atual ("👋 Olá, *Nome*! Você já está cadastrado…") ganha um botão a mais:
- `💰 Devolver dízimo` · `➕ Adicionar membro` · `🔙 Menu` (3 botões = limite do WhatsApp).

### 2. Adicionar membro (cadastro completo, vinculado ao responsável)
- Reaproveita as etapas: nome → apelido → nascimento → endereço → valor mensal.
- **Pula:** confirmação de número (membro não tem telefone próprio), comunidade (herda a do responsável) e notificações.
- Cria `x_dizimista` com `x_studio_responsavel = responsavel.id`, `x_studio_comunidade` = a do responsável, **sem** `x_studio_partner_phone`.
- Controlado por flag temporária no estado (`cadastrandoMembro=true`, `responsavelId`).

### 3. Devolver dízimo (individual ou em lote)
1. Monta a família (responsável + membros).
2. Se **1** → fluxo atual (sem mudança).
3. Se **>1** → pergunta **"De quem é a devolução?"** (Opção B):
   - **2 membros** → 3 **botões**: `[Membro A] [Membro B] [Todos]` (cobre um, o outro ou os dois).
   - **3+ membros** → **lista**: `✅ Todos — R$ <total>` (`fam_todos`) · `1. Nome — R$ X` (`fam_<id>`) · `✏️ Escolher vários…` (`fam_escolher`).
   - "Escolher vários" → bot pede "digite os números (ex.: `1,3`)" (estado `AGUARDANDO_SELECAO_FAMILIA`).
   - Até 8 membros na lista; 9+ improvável → sem paginação (mostra 8 + "Todos" com aviso).
4. Calcula o **total** = soma dos valores selecionados; mostra os dados de pagamento (chave PIX da comunidade) + **QR do total** + detalhamento (quem × quanto).
5. Estado `AGUARDANDO_COMPROVANTE_FAMILIA`, guardando os ids selecionados.
6. Ao receber o comprovante: OCR + validação de chave (**BL-26**) → cria **uma devolução por membro** (valor = valor mensal do membro), com o **mesmo comprovante** anexado e o mesmo `x_studio_grupo_pagamento`. Mensagem final lista quem foi registrado; chave divergente/ausente → todos "em conferência" (igual BL-26).

### 4. Histórico (individual — sem visão de família)
- **1 cadastro** → mostra direto o histórico da pessoa (como hoje).
- **2+ na família** → pergunta **"De quem é o histórico?"** (Opção B: 2–3 → botões; 4+ → lista, só os membros, **sem** "Todos") → histórico **individual** do escolhido (estado `AGUARDANDO_SELECAO_HISTORICO`).

## Impacto no código

| Arquivo | Mudança |
|---|---|
| `OdooService.gs` | `listarFamilia(responsavelId)` (responsável + membros); `criarMembro(dados, responsavelId)` (grava `x_studio_responsavel`, comunidade herdada, sem telefone); `registrarDevolucaoEmLote(...)`. |
| `CadastroHandler.gs` | Botão "Adicionar membro" na mensagem de já-cadastrado; cadastro de membro (flag; pular número/comunidade/notificações; finalizar vinculado ao responsável). |
| `DevolucaoHandler.gs` | "Devolver dízimo" e "Meu histórico" consideram a família (botões ≤3 / lista; "Todos" só no Devolver). |
| `ComprovanteHandler.gs` | Em contexto de família, criar N devoluções em vez de 1. |
| `Router.gs` | Botão `btn_adicionar_membro`; botões/linhas `fam_*`; roteamento dos novos estados. |
| `Config.gs` | Estados `AGUARDANDO_SELECAO_FAMILIA`, `AGUARDANDO_SELECAO_HISTORICO`, `AGUARDANDO_COMPROVANTE_FAMILIA`. |

## Observações / limitações

- **`x_studio_partner_phone` é related de `x_studio_partner_id.phone`** (res.partner). Por isso NÃO usamos telefone para vincular a família — o vínculo é o campo `x_studio_responsavel`.
- Membros **não têm telefone** → não recebem notificações nem falam com o bot; tudo pelo responsável.
- **WhatsApp (UI — Opção B):** ≤3 opções → botões; mais → lista (10 linhas, seleção única). Devolver: 2 membros = botões `[A][B][Todos]`; 3+ = lista. Histórico: 2–3 = botões; 4+ = lista. Subconjunto ("alguns") só na lista, via texto (`1,3`). Até 8 membros por lista.
- Se um dizimista que **é membro** tiver telefone e falar com o bot (caso raro), o v1 o trata como responsável da própria família (ele + quem apontar para ele). Refinar depois se necessário.

## Plano de implementação (fases)

- **Fase 0 (usuário — necessário):** criar `x_dizimista.x_studio_responsavel` (m2o → x_dizimista). *(Opcional: `x_devolucao.x_studio_grupo_pagamento` para a Fase 2.)*
- **Fase 1:** botão "Adicionar membro" + cadastro de membro vinculado ao responsável + `listarFamilia`.
- **Fase 2:** "Devolver dízimo" com seleção (membro/Todos/alguns) → pagamento em lote → N devoluções.
- **Fase 3:** polimento (agrupamento por pagamento, mensagens).
