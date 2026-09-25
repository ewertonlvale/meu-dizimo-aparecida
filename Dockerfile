# ============================================================================
# Dockerfile — o runtime Node do bot (BL-74, Fase 2)
# ============================================================================
#
# A MESMA imagem serve os dois serviços da Fase 3 (webhook público, worker
# privado); o papel vem da variável PAPEL. Na Fase 2 só existe PAPEL=local.
#
# ⚠️ NÃO FOI CONSTRUÍDA AINDA: a máquina onde isto foi escrito não tem Docker.
#    O que está provado é o código (ferramentas/prova-runtime.mjs); a imagem
#    se prova no primeiro `gcloud builds submit`, na sessão de nuvem da Fase 2.
#
# Sem dependências de npm: só a biblioteca padrão do Node. Não há
# package.json, `npm install` nem node_modules para auditar.
#
# O fuso não é definido aqui: o servidor lê o do appsscript.json (o mesmo que
# o Apps Script usa) antes de subir as worker threads.

FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Só o que roda: os .gs, o que decide quais deles carregar (.claspignore), o
# fuso (appsscript.json) e o servidor. A suíte de testes do editor fica de fora
# pelo .dockerignore.
COPY appsscript.json .claspignore ./
COPY *.gs ./
COPY servidor ./servidor

USER node
EXPOSE 8080
CMD ["node", "servidor/index.mjs"]
