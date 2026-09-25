# Roteiro do corte — Apps Script → Cloud Run (BL-74, Fase 5)

**O que é:** o passo a passo do dia em que a Meta passa a entregar as mensagens ao Cloud Run.
Feito para ser seguido **na ordem**, sem pular. Cada passo diz o que conferir antes de seguir.

**Quanto tempo:** ~30 min de execução + uma semana de observação.
**Quando:** **de madrugada (≈ 3h)**. O estado das conversas não migra (vive no cache do Apps Script,
que não se lista): quem estiver no meio de uma conversa volta ao menu. Às 3h praticamente ninguém
está. E longe da janela dos lembretes (a partir das 9h).

**A volta existe e é rápida:** o Apps Script fica de pé, intacto, por uma semana. Voltar é colar a
URL antiga na Meta — ver **"Se der errado"**, no fim. Deixe essa seção aberta numa aba.

---

## D-1 — na véspera, com calma

- [ ] **Anote a URL de callback ATUAL da Meta**, inteira, com o `?token=…`. É o caminho de volta.
      Meta for Developers → seu app → WhatsApp → Configuração → Webhook. Guarde fora do chat e fora
      do repositório (ela contém o segredo).
- [ ] **Anote o valor de `NOTIFICACOES_ATIVAS`** nas Propriedades do script do Apps Script
      (`true`, `false` ou **ausente**). O Cloud Run vai receber o mesmo — ausente quer dizer ligado.
- [ ] **Publique a última `staging` nos dois lados:** `git pull` + `clasp push` (Apps Script) e
      *Actions → Deploy do runtime Node → Run workflow* (Cloud Run), e espere o deploy ficar verde.
- [ ] **Confira que os dois agendamentos estão PAUSADOS** (Cloud Shell):
      ```bash
      gcloud scheduler jobs list --location=southamerica-east1 --format="table(ID,state)"
      ```
- [ ] **Deixe o repositório no Cloud Shell em dia** (é de lá que roda a importação):
      ```bash
      cd ~/meu-dizimo-aparecida && git pull
      ```

---

## Hora H

### 1. Abrir o webhook para a internet

Até aqui ele era privado. A Meta precisa alcançá-lo — e quem não tiver a assinatura leva 401.

```bash
gcloud run services add-iam-policy-binding meu-dizimo-webhook --region=southamerica-east1 --member=allUsers --role=roles/run.invoker --format=none
```

**Confira** — sem login nenhum, a verificação da Meta tem de responder o desafio:

```bash
URL_WEBHOOK=$(gcloud run services describe meu-dizimo-webhook --region=southamerica-east1 --format='value(status.url)') && read -rp "VERIFY_TOKEN: " VT && curl -s "$URL_WEBHOOK/webhook?hub.mode=subscribe&hub.verify_token=$VT&hub.challenge=CORTE-OK"; echo; echo "URL para a Meta: $URL_WEBHOOK/webhook"
```

Esperado: `CORTE-OK`. **Anote a "URL para a Meta"** — é a do passo 3.
⚠️ O **worker continua privado**. Ele nunca é aberto.

### 2. Levar as propriedades

**No editor do Apps Script:** Executar → `exportarPropriedadesParaMigracao`. Copie a linha do `{` ao `}`.

**No Cloud Shell**, cole no arquivo (cole, Enter, **Ctrl+D**):

```bash
cd ~/meu-dizimo-aparecida && cat > propriedades.json
```

Simule e confira a contagem (≈ 18–30 propriedades; nenhuma recusa):

```bash
export UPSTASH_REDIS_REST_URL="https://cuddly-lark-297915.upstash.io" && export UPSTASH_REDIS_REST_TOKEN="$(gcloud secrets versions access latest --secret=UPSTASH_REDIS_REST_TOKEN)" && node ferramentas/importar-propriedades.mjs propriedades.json
```

Grave:

```bash
node ferramentas/importar-propriedades.mjs propriedades.json --aplicar && rm propriedades.json
```

Esperado: `✅ … gravada(s) e conferida(s) no Upstash`.

### 3. Trocar a URL na Meta — o corte

Meta for Developers → seu app → WhatsApp → Configuração → Webhook → **Editar**:

- **URL de callback:** a do passo 1, terminando em `/webhook` — **sem** `?token=`
- **Token de verificação:** o mesmo `VERIFY_TOKEN` de sempre

**Verificar e salvar.** A Meta chama o webhook novo para conferir; se aceitar, **a partir deste
instante as mensagens vão para o Cloud Run**. Confira que o campo `messages` continua assinado na
lista de campos do webhook.

### 4. Provar com uma mensagem de verdade

Do seu celular, mande **"oi"** ao bot. O menu tem de chegar. Confira no log do worker que foi ele:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="meu-dizimo-worker" AND textPayload:"Mensagem de"' --limit=5 --freshness=5m --format="value(timestamp,textPayload)"
```

E que o webhook não está recusando assinaturas (tem de sair **vazio**):

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="meu-dizimo-webhook" AND textPayload:"POST recusado"' --limit=5 --freshness=10m --format="value(timestamp,textPayload)"
```

**Se o menu não chegar em 1 minuto, ou houver "POST recusado": volte já — seção "Se der errado".**
Com o webhook respondendo 401, a Meta guarda as mensagens e reenvia; nada se perde enquanto você volta.

Faça também **uma devolução completa com comprovante** — é o caminho que ainda não rodou na nuvem
(Vision + gravação no Odoo). Confira o registro no Odoo.

### 5. Trocar os agendamentos — nunca os dois ligados

**Primeiro desliga o Apps Script.** No editor: Executar → `removerTriggerNotificacoes`, depois
Executar → `removerTriggerSessoes`. Confira em **Acionadores** (ícone de relógio) que a lista ficou
vazia.

**Depois liga o Cloud Run.** Os lembretes seguem o que o Apps Script tinha (anotado na D-1).
No **mesmo terminal do passo 2** (ele usa as variáveis do Upstash definidas lá). Se lá estava
`true` ou **ausente**:

```bash
curl -s -X POST "$UPSTASH_REDIS_REST_URL" -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" -d '["HSET","p","NOTIFICACOES_ATIVAS","true"]'; echo
```

(Se estava `false`, troque `true` por `false` no comando — e os lembretes continuam desligados,
como estavam.) O valor gravado no Upstash vence a variável `NOTIFICACOES_ATIVAS=false` do deploy.

Retome os dois jobs:

```bash
gcloud scheduler jobs resume lembretes --location=southamerica-east1 && gcloud scheduler jobs resume sessoes --location=southamerica-east1 && gcloud scheduler jobs list --location=southamerica-east1 --format="table(ID,schedule,state)"
```

Esperado: os dois `ENABLED`.

**Pronto: o bot está no Cloud Run.**

---

## A semana de observação

| Quando | O que olhar | Onde |
|---|---|---|
| Todo dia | erros | Cloud Run → `meu-dizimo-worker` → Registros → Gravidade: **Erro** |
| Todo dia | tarefas presas (a lista deve estar vazia) | Cloud Tasks → `mensagens` → Tarefas |
| Todo dia | comandos gastos no dia vs. o limite do plano | console.upstash.com → o banco → Usage |
| No 1º dia de lembrete | se saíram, e só uma vez por pessoa | log do worker, filtro `Notif` |
| O tempo todo | se alguém reclamar | a conversa da pessoa: busca pelo número no log |

**Critério para encerrar a fase:** 7 dias sem incidente, com **pelo menos um ciclo de lembretes**.
Até lá, **não apague nada do Apps Script** — ele é a volta.

---

## Se der errado — a volta (≈ 2 min)

1. **Meta:** Webhook → Editar → cole a **URL antiga** (a da D-1, com `?token=`) e o mesmo token de
   verificação → Verificar e salvar. As mensagens voltam ao Apps Script na hora.
2. **Pause os agendamentos do Cloud Run:**
   ```bash
   gcloud scheduler jobs pause lembretes --location=southamerica-east1 && gcloud scheduler jobs pause sessoes --location=southamerica-east1
   ```
3. **Religue os do Apps Script:** Executar → `instalarTriggerNotificacoes` e
   `instalarTriggerSessoes`.
4. Me mande o que viu no log. O Cloud Run fica de pé, sem tráfego, para investigar.

**O que se perde na volta:** o que o Cloud Run gravou no Upstash enquanto atendeu (sessões,
contadores do período) não volta ao Apps Script. Os contadores do mês ficam um pouco baixos; o
resto se refaz sozinho. **Nada que esteja no Odoo se perde** — devoluções, cadastros, contatos.

---

## Depois da semana (Fase 6)

Não faça nada disto antes: é aqui que o caminho de volta acaba.

- Tornar o deploy do Cloud Run automático a cada merge na `main`, e aposentar `clasp push`.
- Trocar o `NOTIFICACOES_ATIVAS=false` do workflow pelo valor definitivo.
- Trocar o `WEBHOOK_SECRET` (ele vazou; agora só vive entre o worker e os `.gs`).
- Log estruturado, alerta de taxa de erro, uptime do `/saude`.
- Aposentar o Apps Script (desligar a implantação; guardar o projeto por um mês).
