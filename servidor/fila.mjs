/**
 * fila.mjs — enfileirar o webhook no Cloud Tasks (BL-74, Fase 3).
 *
 * O PORQUÊ
 *   No Apps Script, a Meta espera o bot processar tudo — 10 a 24 s num
 *   comprovante — antes de receber o 200. Com a fila, o webhook só autentica,
 *   enfileira e responde em milissegundos; o processamento acontece no worker,
 *   com nova tentativa automática se falhar.
 *
 * IDEMPOTÊNCIA É DA FILA. O nome da tarefa é o SHA-256 do corpo do POST. A
 * Meta reentrega o MESMO corpo quando não recebe resposta a tempo, e o Cloud
 * Tasks recusa criar duas tarefas com o mesmo nome (409). É isto que fecha a
 * corrida que sobrou do BL-78: duas entregas simultâneas passavam juntas pelo
 * `get` do cache antes de qualquer `put`.
 *
 * SEM CHAVE: o token de acesso vem do servidor de metadados da Google, em nome
 * da conta de serviço do próprio serviço. SEM BIBLIOTECA: é a API REST.
 *
 * Assíncrono de propósito — roda na thread principal do webhook, que não
 * executa os `.gs` e nunca bloqueia.
 */

import { createHash } from 'node:crypto';

const API_PADRAO = 'https://cloudtasks.googleapis.com';
const METADADOS_PADRAO = 'http://metadata.google.internal';

// Os dois endereços podem ser trocados para teste — só para 127.0.0.1. Um valor
// errado aqui mandaria o TOKEN DE ACESSO da conta de serviço para fora.
function soLocal(url, nome) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`${nome}: só pode ser trocado para 127.0.0.1 — recusado "${url}"`);
  }
  return url.replace(/\/+$/, '');
}

/**
 * @param {Object} env - FILA_PROJETO, FILA_REGIAO, FILA_NOME, WORKER_URL,
 *   INVOCADOR_SA; e, só em teste, TASKS_API e METADADOS_URL.
 */
export function criarFila(env) {
  const faltam = ['FILA_PROJETO', 'FILA_REGIAO', 'FILA_NOME', 'WORKER_URL', 'INVOCADOR_SA']
    .filter((k) => !env[k]);
  if (faltam.length) throw new Error(`fila: faltam ${faltam.join(', ')}`);

  const api = env.TASKS_API ? soLocal(env.TASKS_API, 'TASKS_API') : API_PADRAO;
  const metadados = env.METADADOS_URL ? soLocal(env.METADADOS_URL, 'METADADOS_URL') : METADADOS_PADRAO;
  const fila = `projects/${env.FILA_PROJETO}/locations/${env.FILA_REGIAO}/queues/${env.FILA_NOME}`;
  const destino = `${env.WORKER_URL.replace(/\/+$/, '')}/processar`;

  let token = null;   // { valor, vence }
  async function tokenDeAcesso() {
    if (token && token.vence > Date.now() + 60000) return token.valor;
    const r = await fetch(`${metadados}/computeMetadata/v1/instance/service-accounts/default/token`,
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`metadados: HTTP ${r.status}`);
    const j = await r.json();
    token = { valor: j.access_token, vence: Date.now() + (Number(j.expires_in) || 300) * 1000 };
    return token.valor;
  }

  return {
    /**
     * Enfileira o corpo cru do webhook.
     * @returns {Promise<'criada'|'repetida'>}
     */
    async enfileirar(corpo) {
      const id = createHash('sha256').update(corpo).digest('hex');
      const r = await fetch(`${api}/v2/${fila}/tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await tokenDeAcesso()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: {
          name: `${fila}/tasks/${id}`,
          httpRequest: {
            httpMethod: 'POST',
            url: destino,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(corpo, 'utf8').toString('base64'),
            // O worker é PRIVADO: só entra quem trouxer um token OIDC desta
            // conta, emitido para esta audiência. Quem verifica é o Cloud Run.
            oidcToken: { serviceAccountEmail: env.INVOCADOR_SA, audience: env.WORKER_URL.replace(/\/+$/, '') },
          },
        } }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 409) return 'repetida';   // a mesma entrega, de novo
      if (!r.ok) throw new Error(`Cloud Tasks: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return 'criada';
    },
  };
}
