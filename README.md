# meu-dizimo-aparecida

Bot de WhatsApp para gestão de dízimo paroquial, rodando em **Google Apps Script** como
Web App. Permite ao dizimista se cadastrar, registrar devoluções enviando o comprovante do
PIX e consultar o próprio histórico; coordenadores e administradores consultam relatórios e
dão baixa nas devoluções pendentes.

**Integrações:** WhatsApp Cloud API (Meta) · Odoo (JSON-RPC, modelos `x_*`) ·
Google Cloud Vision (OCR dos comprovantes).

## Documentação

| Documento | O que é |
|---|---|
| **[Arquitetura e convenções](Documenta%C3%A7%C3%A3o/ARQUITETURA.md)** | **Comece por aqui.** Modelo de armazenamento, chamadas externas, concorrência e publicação — as regras a respeitar ao mexer no código |
| [Backlog](Documenta%C3%A7%C3%A3o/BACKLOG.md) | Itens de trabalho, o que já foi corrigido e por quê. Registro histórico |
| [Funcionalidade Família](Documenta%C3%A7%C3%A3o/FUNCIONALIDADE-FAMILIA.md) | Cadastro de membros e devolução em lote |
| [historico/](Documenta%C3%A7%C3%A3o/historico/) | Documentos arquivados, mantidos só como registro — não descrevem o estado atual |

## Estrutura

```
*.gs                  código do Apps Script (enviado pelo clasp)
appsscript.json       manifesto do projeto
.claspignore          o que NÃO sobe: testes e site público
docs/                 site público (GitHub Pages — meudizimo.pnscaparecida.com)
Documentação/         documentação do projeto
Tests*.gs, Teste*.gs  suíte de testes (fora do deploy — ver .claspignore)
```

## Publicando

```bash
clasp push        # envia o código (não envia testes nem docs/)
```

Depois do push é preciso **republicar o deployment** no editor (Implantar → Gerenciar
implantações → nova versão). Sem isso a URL do webhook continua servindo o código antigo.

⚠️ `clasp push` sincroniza: arquivos que deixam de ser enviados são **removidos** do projeto
online.

As funções de setup (configuração, criação de campos no Odoo, instalação de triggers) estão
listadas na [seção 4 da Arquitetura](Documenta%C3%A7%C3%A3o/ARQUITETURA.md#4-publicação).

## Antes de contribuir

Três regras que, se ignoradas, causam bugs difíceis de achar — todas detalhadas na
[Arquitetura](Documenta%C3%A7%C3%A3o/ARQUITETURA.md):

1. **Não chame `UrlFetchApp.fetch` diretamente.** Use `Utils.fetchComRetry`, e escolha
   `idempotente` com cuidado: repetir um `create` no Odoo duplicaria uma devolução.
2. **Escolha o armazenamento certo.** `CacheService` não lista chaves e pode ser despejado;
   `PropertiesService` não tem TTL e divide o store com a configuração.
3. **Nenhum dos dois tem operação atômica.** Prefira uma chave por usuário a uma estrutura
   compartilhada sob lock — o `LockService` aqui só oferece lock global.
