// "Cérebro" da casinha: acompanha o estado no Orion, registra atividades,
// controla comandos pendentes, conta o tempo de uso das luzes e roda a automação.
import {
  DEVICES, LAMP_KEYS, ACTUATOR_KEYS, COMMAND_TARGET, COMMAND_VERB, SCENES, DEFAULT_SETTINGS,
  POLL_MS, COMMAND_TIMEOUT_MS, ESP32_OFFLINE_MS,
} from './config.js';
import * as fiware from './fiware.js';
import { HttpError, isOffline } from './fiware.js';
import { load, save } from './store.js';

const MAX_ACTIVITY = 300;
const MAX_MEM_HISTORY = 400;

/* ------------------------------------------------------------------ */
/* Estado                                                               */
/* ------------------------------------------------------------------ */

const settings = (() => {
  try {
    return mergeSettings(structuredClone(DEFAULT_SETTINGS), load('settings.json', {}));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
})();
let activity = load('activity.json', []);
const stats = load('stats.json', {
  day: today(),
  lamps: Object.fromEntries(LAMP_KEYS.map((k) => [k, { onSince: null, todayMs: 0, switches: 0 }])),
  autoPhase: null,
  autoLastRun: null,
});

const runtime = {
  fiware: { status: 'connecting', error: null, checkedAt: null },
  provisioned: false,
  devices: {}, // key -> { state, changedAt, updatedAt, changedBy }
  luminosity: { value: null, updatedAt: null },
  lastSeen: null,
  pending: {}, // key -> { command, target, since, source }
  memHistory: [], // fallback do STH-Comet
  auto: { darkCount: 0, brightCount: 0 },
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */

function today() {
  return new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no horário local
}

function deviceName(key) {
  return settings.lampNames[key] ?? DEVICES[key]?.label ?? key;
}

function stateMessage(key, state) {
  const name = deviceName(key);
  switch (state) {
    case 'on': return `${name} acendeu`;
    case 'off': return `${name} apagou`;
    case 'open': return 'Janela abriu';
    case 'closed': return 'Janela fechou';
    case 'extended': return 'Varal foi estendido';
    case 'retracted': return 'Varal foi recolhido';
    default: return `${name}: ${state}`;
  }
}

export function log(type, message, extra = {}) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    type, // command | scene | automation | state | error | system
    message,
    ...extra,
  };
  activity.unshift(event);
  if (activity.length > MAX_ACTIVITY) activity.length = MAX_ACTIVITY;
  save('activity.json', activity);
  return event;
}

function attrTime(entity, attr) {
  return entity?.[attr]?.metadata?.TimeInstant?.value ?? entity?.TimeInstant?.value ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Leitura periódica do Orion                                           */
/* ------------------------------------------------------------------ */

async function poll() {
  let entities;
  try {
    entities = await fiware.getEntities();
    if (runtime.fiware.status !== 'ok' && runtime.fiware.status !== 'connecting') {
      log('system', 'Conexão com o FIWARE restabelecida');
    }
    runtime.fiware = { status: 'ok', error: null, checkedAt: new Date().toISOString() };
  } catch (e) {
    const status = isOffline(e) ? 'offline' : 'error';
    if (runtime.fiware.status !== status) {
      log('error', status === 'offline'
        ? 'FIWARE fora do ar — o docker compose está rodando?'
        : `Erro ao consultar o FIWARE: ${e.message}`);
    }
    runtime.fiware = { status, error: e.message, checkedAt: new Date().toISOString() };
    return;
  }

  const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
  runtime.provisioned = Object.values(DEVICES).every((d) => byId[d.entityId]);

  // último sinal de vida do ESP32
  for (const d of Object.values(DEVICES)) {
    const t = byId[d.entityId]?.TimeInstant?.value;
    if (t && (!runtime.lastSeen || t > runtime.lastSeen)) runtime.lastSeen = t;
  }

  // Luminosidade
  const sensor = byId[DEVICES.sensor.entityId];
  const lum = sensor?.luminosity?.value;
  const lumTime = attrTime(sensor, 'luminosity');
  if (typeof lum === 'number' || (typeof lum === 'string' && lum !== '' && !Number.isNaN(Number(lum)))) {
    const value = Number(lum);
    const isNew = lumTime && lumTime !== runtime.luminosity.updatedAt;
    runtime.luminosity = { value, updatedAt: lumTime };
    if (isNew) {
      runtime.memHistory.push({ time: lumTime, value });
      if (runtime.memHistory.length > MAX_MEM_HISTORY) runtime.memHistory.shift();
      evaluateAutomation(value);
    }
  }

  // Atuadores
  for (const key of ACTUATOR_KEYS) {
    const entity = byId[DEVICES[key].entityId];
    const newState = entity?.state?.value || null;
    const updatedAt = attrTime(entity, 'state');
    const prev = runtime.devices[key];

    if (!prev) {
      runtime.devices[key] = { state: newState, updatedAt, changedAt: updatedAt, changedBy: null };
      if (LAMP_KEYS.includes(key)) syncLampStats(key, newState, true);
      continue;
    }

    prev.updatedAt = updatedAt;
    if (newState && newState !== prev.state) {
      const pending = runtime.pending[key];
      const changedBy = pending && pending.target === newState ? pending.source : 'device';
      prev.state = newState;
      prev.changedAt = new Date().toISOString();
      prev.changedBy = changedBy;
      log('state', stateMessage(key, newState), { device: key, source: changedBy });
      if (LAMP_KEYS.includes(key)) syncLampStats(key, newState, false);
    }

    const pending = runtime.pending[key];
    if (pending && prev.state === pending.target) delete runtime.pending[key];
  }
}

function checkPendingTimeouts() {
  const now = Date.now();
  for (const [key, p] of Object.entries(runtime.pending)) {
    if (now - p.since > COMMAND_TIMEOUT_MS) {
      delete runtime.pending[key];
      log('error', `O ESP32 não confirmou o comando "${COMMAND_VERB[p.command]} ${deviceName(key).toLowerCase()}"`, {
        device: key,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Estatísticas das luzes                                               */
/* ------------------------------------------------------------------ */

function rollDay() {
  const d = today();
  if (stats.day === d) return;
  stats.day = d;
  for (const s of Object.values(stats.lamps)) {
    s.todayMs = 0;
    s.switches = 0;
    if (s.onSince) s.onSince = Date.now();
  }
  save('stats.json', stats);
}

function syncLampStats(key, state, initial) {
  rollDay();
  const s = stats.lamps[key];
  if (state === 'on' && !s.onSince) {
    s.onSince = Date.now();
    if (!initial) s.switches += 1;
  } else if (state === 'off' && s.onSince) {
    s.todayMs += Date.now() - s.onSince;
    s.onSince = null;
  }
  save('stats.json', stats);
}

function lampUsage(key) {
  const s = stats.lamps[key];
  return {
    onSince: s.onSince ? new Date(s.onSince).toISOString() : null,
    todayMs: s.todayMs + (s.onSince ? Date.now() - s.onSince : 0),
    switches: s.switches,
  };
}

/* ------------------------------------------------------------------ */
/* Comandos, cenas e teste                                              */
/* ------------------------------------------------------------------ */

export async function command(key, cmd, source = 'manual') {
  const dev = DEVICES[key];
  if (!dev?.commands) throw new HttpError(404, 'Dispositivo inexistente');
  if (!dev.commands.includes(cmd)) {
    throw new HttpError(400, `Comando inválido para ${dev.label}. Use: ${dev.commands.join(', ')}`);
  }
  try {
    await fiware.sendCommand(dev.entityId, cmd);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      throw new HttpError(409, 'Dispositivo não provisionado. Rode "npm run provision" na pasta fiwares.');
    }
    if (isOffline(e)) throw new HttpError(503, 'FIWARE fora do ar — o docker compose está rodando?');
    throw e;
  }
  runtime.pending[key] = { command: cmd, target: COMMAND_TARGET[cmd], since: Date.now(), source };
  if (source === 'manual') {
    log('command', `Você mandou ${COMMAND_VERB[cmd]} ${deviceName(key).toLowerCase()}`, { device: key, source });
  }
}

// Envia só o que precisa mudar (não mexe no servo à toa)
async function applyActions(actions, source) {
  const sent = [];
  for (const [key, cmd] of actions) {
    if (cmd === 'none') continue;
    const current = runtime.devices[key]?.state;
    if (current === COMMAND_TARGET[cmd]) continue;
    await command(key, cmd, source);
    sent.push(`${COMMAND_VERB[cmd]} ${deviceName(key).toLowerCase()}`);
  }
  return sent;
}

export async function runScene(id) {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new HttpError(404, 'Cena inexistente');
  const sent = await applyActions(scene.actions, 'scene');
  log('scene', sent.length
    ? `Cena "${scene.name}": ${sent.join(', ')}`
    : `Cena "${scene.name}": tudo já estava no lugar`, { scene: id });
  return { sent };
}

export async function allLamps(cmd) {
  if (!['on', 'off'].includes(cmd)) throw new HttpError(400, 'Use on ou off');
  const sent = await applyActions(LAMP_KEYS.map((k) => [k, cmd]), 'all');
  log('command', cmd === 'on' ? 'Você acendeu todas as luzes' : 'Você apagou todas as luzes');
  return { sent };
}

let testRunning = false;
export async function hardwareTest() {
  if (testRunning) throw new HttpError(409, 'O teste já está em andamento');
  if (runtime.fiware.status !== 'ok') throw new HttpError(503, 'FIWARE fora do ar');
  testRunning = true;
  log('system', 'Teste de hardware iniciado: cada luz pisca e os servos vão e voltam');
  (async () => {
    try {
      for (const key of LAMP_KEYS) {
        const original = runtime.devices[key]?.state === 'on' ? 'on' : 'off';
        await command(key, original === 'on' ? 'off' : 'on', 'test');
        await sleep(1500);
        await command(key, original, 'test');
        await sleep(800);
      }
      for (const [key, a, b] of [['window', 'open', 'close'], ['clothesline', 'extend', 'retract']]) {
        const isA = runtime.devices[key]?.state === COMMAND_TARGET[a];
        await command(key, isA ? b : a, 'test');
        await sleep(4000);
        await command(key, isA ? a : b, 'test');
        await sleep(4000);
      }
      log('system', 'Teste de hardware concluído');
    } catch (e) {
      log('error', `Teste de hardware interrompido: ${e.message}`);
    } finally {
      testRunning = false;
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Automação por luminosidade                                           */
/* ------------------------------------------------------------------ */

function evaluateAutomation(value) {
  const a = settings.automation;
  if (!a.enabled) return;
  const auto = runtime.auto;

  if (value <= a.darkThreshold) {
    auto.darkCount += 1;
    auto.brightCount = 0;
  } else if (value >= a.brightThreshold) {
    auto.brightCount += 1;
    auto.darkCount = 0;
  } else {
    auto.darkCount = 0;
    auto.brightCount = 0;
  }

  let phase = null;
  if (auto.darkCount >= a.confirmSamples && stats.autoPhase !== 'dark') phase = 'dark';
  if (auto.brightCount >= a.confirmSamples && stats.autoPhase !== 'bright') phase = 'bright';
  if (!phase) return;

  stats.autoPhase = phase;
  stats.autoLastRun = new Date().toISOString();
  save('stats.json', stats);

  const actions = Object.entries(a[phase]);
  applyActions(actions, 'automation')
    .then((sent) => {
      const label = phase === 'dark' ? `Escureceu (${value}%)` : `Clareou (${value}%)`;
      log('automation', sent.length ? `${label}: ${sent.join(', ')}` : `${label}: nada precisou mudar`, { phase });
    })
    .catch((e) => log('error', `Automação falhou: ${e.message}`));
}

/* ------------------------------------------------------------------ */
/* Configurações                                                        */
/* ------------------------------------------------------------------ */

function mergeSettings(base, patch) {
  if (patch?.lampNames) {
    for (const k of LAMP_KEYS) {
      const name = patch.lampNames[k];
      if (typeof name === 'string' && name.trim()) base.lampNames[k] = name.trim().slice(0, 24);
    }
  }
  const pa = patch?.automation;
  if (pa) {
    const a = base.automation;
    if (typeof pa.enabled === 'boolean') a.enabled = pa.enabled;
    for (const field of ['darkThreshold', 'brightThreshold']) {
      if (pa[field] !== undefined) {
        const n = Math.round(Number(pa[field]));
        if (Number.isNaN(n) || n < 0 || n > 100) throw new HttpError(400, 'Os limites devem estar entre 0 e 100');
        a[field] = n;
      }
    }
    if (pa.confirmSamples !== undefined) {
      const n = Math.round(Number(pa.confirmSamples));
      if (Number.isNaN(n) || n < 1 || n > 20) throw new HttpError(400, 'Leituras de confirmação: entre 1 e 20');
      a.confirmSamples = n;
    }
    for (const phase of ['dark', 'bright']) {
      if (!pa[phase]) continue;
      for (const key of ACTUATOR_KEYS) {
        const v = pa[phase][key];
        if (v === undefined) continue;
        if (v !== 'none' && !DEVICES[key].commands.includes(v)) {
          throw new HttpError(400, `Ação inválida "${v}" para ${DEVICES[key].label}`);
        }
        a[phase][key] = v;
      }
    }
    if (a.darkThreshold >= a.brightThreshold) {
      throw new HttpError(400, 'O limite de "escuro" precisa ser menor que o de "claro"');
    }
  }
  return base;
}

export function getSettings() {
  return settings;
}

export function updateSettings(patch) {
  const wasEnabled = settings.automation.enabled;
  const next = mergeSettings(structuredClone(settings), patch); // valida antes de aplicar
  Object.assign(settings, next);
  save('settings.json', settings);

  const nowEnabled = settings.automation.enabled;
  if (patch?.automation) {
    // recomeça a contagem para aplicar a regra já na próxima leitura estável
    runtime.auto = { darkCount: 0, brightCount: 0 };
    stats.autoPhase = null;
    save('stats.json', stats);
    if (wasEnabled !== nowEnabled) log('system', nowEnabled ? 'Automação ativada' : 'Automação desativada');
    else log('system', 'Regras da automação atualizadas');
  }
  if (patch?.lampNames) log('system', 'Nomes das luzes atualizados');
  return settings;
}

/* ------------------------------------------------------------------ */
/* Consultas                                                            */
/* ------------------------------------------------------------------ */

function actuator(key) {
  const d = runtime.devices[key] ?? {};
  const p = runtime.pending[key];
  return {
    key,
    name: deviceName(key),
    state: d.state ?? null,
    changedAt: d.changedAt ?? null,
    changedBy: d.changedBy ?? null,
    updatedAt: d.updatedAt ?? null,
    pending: p ? { command: p.command, target: p.target, since: new Date(p.since).toISOString(), source: p.source } : null,
  };
}

export function getStatus() {
  rollDay();
  const lastSeenMs = runtime.lastSeen ? Date.parse(runtime.lastSeen) : null;
  const a = settings.automation;
  return {
    now: new Date().toISOString(),
    fiware: runtime.fiware,
    provisioned: runtime.provisioned,
    esp32: {
      online: runtime.fiware.status === 'ok' && lastSeenMs != null && Date.now() - lastSeenMs < ESP32_OFFLINE_MS,
      lastSeen: runtime.lastSeen,
    },
    luminosity: runtime.luminosity,
    lamps: LAMP_KEYS.map((k, i) => ({ ...actuator(k), number: i + 1, ...lampUsage(k) })),
    window: actuator('window'),
    clothesline: actuator('clothesline'),
    automation: {
      enabled: a.enabled,
      darkThreshold: a.darkThreshold,
      brightThreshold: a.brightThreshold,
      confirmSamples: a.confirmSamples,
      phase: stats.autoPhase,
      lastRun: stats.autoLastRun,
      darkCount: runtime.auto.darkCount,
      brightCount: runtime.auto.brightCount,
    },
    testRunning,
    recentActivity: activity.slice(0, 8),
  };
}

export function getActivity({ type, limit = 100 } = {}) {
  const list = type ? activity.filter((e) => e.type === type) : activity;
  return list.slice(0, Math.min(Number(limit) || 100, MAX_ACTIVITY));
}

export function clearActivity() {
  activity = [];
  save('activity.json', activity);
  log('system', 'Histórico de atividades limpo');
}

export async function getHistory(lastN) {
  try {
    const sth = await fiware.getLuminosityHistory(DEVICES.sensor.entityId, lastN);
    if (sth.length) return { source: 'sth-comet', points: sth };
  } catch {
    /* usa o histórico em memória */
  }
  return { source: 'memoria', points: runtime.memHistory.slice(-lastN) };
}

/* ------------------------------------------------------------------ */
/* Loop                                                                 */
/* ------------------------------------------------------------------ */

export function start() {
  log('system', 'Backend iniciado');
  const tick = async () => {
    try {
      await poll();
      checkPendingTimeouts();
    } catch (e) {
      console.error('Erro no monitoramento:', e);
    } finally {
      setTimeout(tick, POLL_MS);
    }
  };
  tick();
}
