// Acesso aos componentes FIWARE (Orion, IoT Agent e STH-Comet).
import { ORION_URL, IOTA_URL, STH_URL, FIWARE_HEADERS } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function isOffline(err) {
  return (
    err?.name === 'TimeoutError' ||
    err?.cause?.code === 'ECONNREFUSED' ||
    err?.cause?.code === 'ECONNRESET' ||
    err?.message === 'fetch failed'
  );
}

async function request(base, path, { method = 'GET', body, timeout = 4000 } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...FIWARE_HEADERS, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, `FIWARE respondeu ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

export function getEntities() {
  return request(ORION_URL, '/v2/entities?limit=100');
}

// O Orion repassa o comando ao IoT Agent, que publica no tópico /<apikey>/<device>/cmd
export function sendCommand(entityId, command) {
  return request(ORION_URL, `/v2/entities/${encodeURIComponent(entityId)}/attrs`, {
    method: 'PATCH',
    body: { [command]: { type: 'command', value: '' } },
  });
}

export async function getLuminosityHistory(entityId, lastN) {
  const data = await request(
    STH_URL,
    `/STH/v1/contextEntities/type/LuminositySensor/id/${entityId}/attributes/luminosity?lastN=${lastN}`,
  );
  const values = data?.contextResponses?.[0]?.contextElement?.attributes?.[0]?.values ?? [];
  return values.map((v) => ({ time: v.recvTime, value: Number(v.attrValue) }));
}

async function ping(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const info = await res.json().catch(() => null);
    return { ok: res.ok, ms: Date.now() - started, info };
  } catch {
    return { ok: false, ms: null, info: null };
  }
}

export async function health() {
  const [orion, iotAgent, sth] = await Promise.all([
    ping(`${ORION_URL}/version`),
    ping(`${IOTA_URL}/iot/about`),
    ping(`${STH_URL}/version`),
  ]);
  return {
    orion: { ...orion, version: orion.info?.orion?.version ?? null, url: ORION_URL },
    iotAgent: { ...iotAgent, version: iotAgent.info?.version ?? null, url: IOTA_URL },
    sth: { ...sth, version: sth.info?.version ?? null, url: STH_URL },
  };
}
