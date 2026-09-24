# Notas da revisão — 24/09/2026

Revisão do código da branch `staging` (commit `b557728`, #144) e do escopo da migração descrita
em `MIGRACAO-NIVEL-1.md`. Os itens marcados com ✔ foram conferidos linha a linha; os demais vêm
da leitura dos revisores e merecem uma segunda olhada antes de virar correção.

Nada de produção foi alterado. A única mudança de código feita é a do item 1 (harness).

---

## 1. O harness não passava no Windows — ✅ CORRIGIDO

O `verificar-tudo.mjs` reprovava 3 das 4 suítes na máquina de desenvolvimento (Windows,
Node 24.18), enquanto o CI (Ubuntu) passava. É exatamente a divergência *"passa lá, quebra
aqui"* que a Fase 0 do BL-74 existe para impedir. As três causas eram de plataforma:

| Suíte | Causa | Correção |
|---|---|---|
| `conta-mensagens.js` | Com `core.autocrlf=true` os arquivos chegam com CRLF, e a regex `\},\n` que procura os campos no instalador deixava de casar (4 falhas) | Helper `lerTexto()` normaliza `\r\n` → `\n` nas 36 leituras de fonte |
| `provar-dominio-filtro.mjs` | `import(join(...))` com caminho `C:\…` — o ESM lê `c:` como esquema de URL | `import(pathToFileURL(...).href)` |
| `prova-verificador.mjs` | O `instalar-usuario-bot.mjs` caía com `0xC0000409` (3–5 dos 12 cenários por rodada). Reproduzido isolado: no Windows, `process.exit()` logo após ≥3 `fetch` derruba o Node | Helper `sair(codigo)` espera 50 ms antes do `process.exit`; as 16 saídas passam por ele. `setImmediate` não bastava |

Resultado: **4/4 verdes**, e o `prova-verificador` ficou verde em 13 rodadas seguidas.
A verificação textual do `conta-mensagens.js` que procurava `process.exit(faltando || …)` passou
a aceitar também `await sair(…)`.

⚠️ **O conserto do `sair()` é mitigação de tempo, não de causa.** Se voltar a cair, aumentar a
espera. E os outros `instalar-*.mjs`, `baixar-views.mjs` e `odoo-dump.mjs` têm o mesmo padrão
(`process.exit` depois de `fetch`); estão fora do harness, mas podem sair com código de erro
falso no Windows.

⚠️ **Continua pendente o passo manual da Fase 0:** exigir o check *Harness* no ruleset da
`staging` (Settings → Branches).

---

## 2. Bugs na produção atual

Independem da migração — valem para o Apps Script de hoje.

### Alta

- ✔ **Dízimo gravado como oferta.** `OfertaHandler.iniciar` grava `ofertaComunidadeId` na sessão
  ([OfertaHandler.gs:60](../OfertaHandler.gs)) e nada limpa o campo. Quem toca em Oferta, desiste,
  vai para Dízimo e manda comprovante cai em `_tratarResultadoOferta`
  ([ComprovanteHandler.gs:774](../ComprovanteHandler.gs)): gravado com `tipo='oferta'`, some do
  relatório de dízimo. Correção: limpar os campos `oferta*` ao entrar no menu/devolução.
- ✔ **Deduplicação do webhook com TTL de 10 min e não atômica**
  ([Webhook.gs:316-322](../Webhook.gs)). A Meta reentrega por horas; uma reentrega após 10 min
  refaz o `create` da devolução. Sugestão: TTL de 6 h e/ou dedup pelo `messageId` no Odoo.
- ✔ **Reação, figurinha, áudio e afins zeram o fluxo.** Caem no `default` do
  [Router.gs:32](../Router.gs), que chama `menuPrincipal` → `setEstado(MENU)`. Um 👍 no meio do
  cadastro ou antes do comprovante desfaz o estado. Reações deveriam ser ignoradas; os outros
  tipos, avisados sem mexer no estado.
- ✔ **Código de acesso ao relatório vai para o log** — [Router.gs:324](../Router.gs) loga o texto
  de toda mensagem, inclusive em `AGUARDANDO_CODIGO_RELATORIO`. Também vaza endereço, nascimento
  e valores do cadastro por conversa.
- **Baixa confirma a devolução errada.** Botões com id fixo e alvo lido da sessão
  (`pendente_devolucao_id`, RelatorioHandler.gs:987-1049): tocar "Confirmar" numa mensagem antiga
  confirma a última aberta. Não confere se ainda está Pendente nem se a comunidade é do
  coordenador.

### Média

- ✔ **OCR corta valor sem separador de milhar**: "R$ 1234,56" → 123
  ([VisionService.gs:231](../VisionService.gs)) — a regex não tem âncora no fim.
- **`parseValorBR` cola números**: "100 ou 200" → 100200 (Utils.gs:673), sem teto.
- **Devolução duplicada**: dois comprovantes em sequência, ou timeout depois do `create` com
  mensagem pedindo reenvio (ComprovanteHandler.gs:866-873). `criarMembro` sem guarda contra toque
  duplo.
- **Oferta ou devolução rejeitada impede o lembrete de dízimo** — `jaDevolveueEsteMes`
  (NotificacaoHandler.gs:469-480) não filtra tipo nem status.
- **Lote de notificações travável**: números com erro permanente ficam sempre no início da ordem
  (`dia asc, id asc`) e ocupam o lote; falha ao gravar o log reenvia o lembrete a cada degrau;
  `lote` até 200 × 2 s passa dos 6 min.
- **Relatório consolidado soma Pendentes e Rejeitadas** (OdooService.gs:1103).
- ✔ **Primeiro contato gravado em hora local num campo `datetime`**
  ([OdooService.gs:1244](../OdooService.gs)); o Odoo lê como UTC → 3 h a menos na tela.
- **Trigger de sessão apaga cadastro ativo**: `sessao_inicio_` não é renovado; aos 60 min some e
  `limparDados` roda em quem digitou há um minuto (TriggerSessoes.gs:50-57).
- **Lock global segurado durante HTTP** (StateManager.gs:287, OdooService.gs:288) faz o
  `_comLock` desistir em 3 s e gravar sem trava sob carga.

### Baixa

Aviso de expiração em dobro (StateManager.gs:216); 429 da Meta chega como HTTP 400 e o retry não
dispara (Utils.gs:144); PII em log (NotificacaoHandler, OdooService.gs:968); Flow aceita
`comunidade_id` sem conferir (FlowHandler.gs:252); "menu" conta como tentativa errada de PIN;
admin só vê 10 comunidades no relatório; código PIX enviado a `api.qrserver.com`; documento
qualquer com `sha256` tratado como imagem.

**Verificado e sem problema:** injeção em domínio Odoo (valores sempre em array); `create`/envio
não repetem em 5xx; webhook fail-closed; `doGet` não aceita `VERIFY_TOKEN` ausente; chave do Odoo
não aparece em log; lotes com várias `entries`/`messages` iterados corretamente; segredos
(`ferramentas/.odoo-env`) no `.gitignore` e nunca commitados.

---

## 3. Escopo da migração — o que o `MIGRACAO-NIVEL-1.md` acerta, erra e omite

### Acerta

- A tabela de APIs bate (contando produção + testes + comentários): `Utilities` 60,
  `CacheService` 41, `ScriptApp` 9, `ContentService` 7, `UrlFetchApp` 6, `LockService` 4.
- Worker thread com `sync-fetch` é uma decisão sólida para preservar o código síncrono.
- Dois serviços (webhook público / worker privado), jobs nascendo pausados, corte de madrugada.

### Erra

- **17.626 linhas**, não 17.450 (15.189 de produção + 2.437 de testes).
- **`RegistrarNumero.gs:22` chama `UrlFetchApp` direto** — não são "só 2, ambas atrás do
  `fetchComRetry`".
- ✔ **A trigger de sessões roda a cada 5 min** ([TriggerSessoes.gs:150](../TriggerSessoes.gs)),
  não 20. O comentário da linha 27 diz 20; o código, 5.
- **Os 3 locks têm políticas diferentes** — `waitLock(3000)` segue sem trava; `waitLock(5000)`
  desiste; `waitLock(10000)` segue sem trava. Um `comTrava(chave, fn)` genérico não carrega isso.
  A versão Redis precisa de espera ativa e liberação que confira o dono.
- **"O carregamento dos `.gs` no Node está provado" é exagero.** O harness concatena tudo num
  script só (por causa do `const` léxico) e **nunca carrega** `Webhook.gs`, `StateManager.gs`,
  `TriggerSessoes.gs`, `RelatorioHandler.gs`, `Assets.gs`, `AuditoriaNumeros.gs` — justamente a
  entrada e o estado. `listarPropriedades` está duplicada (Setup.gs:447 e 1083).

### Omite — e isto aumenta o escopo

1. **Estado em memória que vaza entre requisições (o risco mais sério).** No GAS cada execução
   começa do zero; numa worker de vida longa, não.
   - ✔ `Utils._mensagemAtualId` (Utils.gs:870) nunca é limpo; `sinalizarProcessando()` sem id
     usa o da mensagem anterior — **possivelmente de outra pessoa**.
   - ✔ `OdooService._camposGravaveis` / `_camposConhecidos` guardam `false` sem TTL após erro
     passageiro (OdooService.gs:640-652): o campo passa a ser descartado em silêncio até o
     processo reiniciar.
   - Contadores do BL-25 (Utils.gs:92-94) vazam se uma execução não chega ao `finally`.

   → Proposta: na Fase 1, uma verificação no harness que proíba estado mutável em módulo fora da
   `Plataforma`, no mesmo formato da que vai proibir as APIs do GAS.
2. **Fuso fora do `formatDate`.** ~33 usos de `getMonth`/`getDate`/`setHours` dependem do
   `timeZone` do `appsscript.json` (NotificacaoHandler, RelatorioHandler, OdooService,
   ComprovanteHandler). No Cloud Run rodariam em UTC. → `TZ=America/Sao_Paulo` no container +
   teste que confirme.
3. **`PropertiesService` não é "25 config + 5 mutáveis".** Há famílias dinâmicas
   (`sessao_ativa_*`, `bloqueado_*`, `suspeito_*`, `media_id_*`, `uso_urlfetch_*`, `msgs_*`) lidas
   por varredura de prefixo com `getProperties()`. → Redis com `SCAN`; a fachada de cache precisa
   de `removeAll`.
4. **Multipart e binário.** `MediaService` (184-191, 305-314) passa objeto com `Blob` e o
   `UrlFetchApp` monta o `multipart/form-data` sozinho; `sync-fetch` não. A fachada `http` precisa
   montar `FormData`, emular `getBlob()`/`getContent()`/`getContentType()` e lançar em 4xx/5xx
   quando não houver `muteHttpExceptions`.
5. **Adaptadores de entrada.** `doGet`/`doPost` (`e.parameter`, `e.postData`, `TextOutput`);
   `ScriptApp.getOAuthToken()` (TriggerSessoes.gs:33), `getService().getUrl()` (Setup.gs:147);
   `Logger.log` com 587 usos precisa de stub. Hoje o webhook responde 200 até para
   `'Forbidden'` — mudar isso muda o reenvio da Meta.
6. **Tempo de execução.** `sleep` em laço (NotificacaoHandler.gs:302, RelatorioHandler.gs:925),
   esperas fixas no MediaService e 9 no CadastroHandler: a worker fica bloqueada — dimensionar
   pool e timeout do Cloud Run.
7. **`appsscript.json`** pede escopo `drive` completo, que parece desnecessário.

Bônus não aproveitado: no Node dá para decifrar RSA-OAEP/AES-GCM e usar o modo *endpoint* dos
Flows, hoje descartado (FlowHandler.gs:14-18).

### Estimativa revisada

Plano: 12–15 dias. Somando as omissões: **16–21 dias**. Palpite, como o do plano; a Fase 1
continua sendo o primeiro dado real.

---

## 4. Próximos passos sugeridos

1. ~~Corrigir o harness no Windows~~ — feito (branch `fix/harness-windows`, não commitado).
2. Ligar o *required check* do Harness na `staging`.
3. Corrigir os bugs de alta da seção 2 — oferta/dízimo e reações são poucas linhas.
4. Atualizar o `MIGRACAO-NIVEL-1.md` com a seção 3 e pôr `Webhook.gs`/`StateManager.gs` no
   harness antes da Fase 1.
