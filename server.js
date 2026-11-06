// API REST da Casinha IoT.
import express from 'express';
import cors from 'cors';
import { PORT, ORION_URL, APIKEY, MQTT_BROKER, DEVICES, SCENES } from './config.js';
import * as house from './house.js';
import * as fiware from './fiware.js';

const app = express();
// CORS_ORIGIN: domínio(s) do frontend separados por vírgula (ex.: https://casinha.vercel.app).
// Sem a variável, aceita qualquer origem (bom para desenvolvimento).
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
app.use(cors(corsOrigins?.length ? { origin: corsOrigins } : undefined));
app.use(express.json());

// evita repetir try/catch em toda rota
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

/* -------- Estado -------- */
app.get('/api/status', (_req, res) => res.json(house.getStatus()));

app.get('/api/luminosity/history', route(async (req, res) => {
  const lastN = Math.min(Math.max(Number(req.query.lastN) || 60, 2), 300);
  res.json(await house.getHistory(lastN));
}));

/* -------- Comandos -------- */
app.post('/api/lamps/all/:action', route(async (req, res) => {
  res.json({ ok: true, ...(await house.allLamps(req.params.action)) });
}));

app.post('/api/lamps/:n/:action', route(async (req, res) => {
  const key = `lamp${Number(req.params.n)}`;
  if (!['lamp1', 'lamp2', 'lamp3'].includes(key)) return res.status(404).json({ error: 'Use luz 1, 2 ou 3' });
  await house.command(key, req.params.action);
  res.json({ ok: true });
}));

app.post('/api/window/:action', route(async (req, res) => {
  await house.command('window', req.params.action);
  res.json({ ok: true });
}));

app.post('/api/clothesline/:action', route(async (req, res) => {
  await house.command('clothesline', req.params.action);
  res.json({ ok: true });
}));

/* -------- Cenas -------- */
app.get('/api/scenes', (_req, res) => res.json(SCENES));
app.post('/api/scenes/:id', route(async (req, res) => {
  res.json({ ok: true, ...(await house.runScene(req.params.id)) });
}));

/* -------- Configurações / automação -------- */
app.get('/api/settings', (_req, res) => res.json(house.getSettings()));
app.put('/api/settings', route(async (req, res) => {
  res.json(house.updateSettings(req.body));
}));

/* -------- Atividade -------- */
app.get('/api/activity', (req, res) => res.json(house.getActivity(req.query)));
app.delete('/api/activity', (_req, res) => {
  house.clearActivity();
  res.json({ ok: true });
});

/* -------- Dispositivos / diagnóstico -------- */
app.get('/api/devices', (_req, res) => {
  res.json({
    apikey: APIKEY,
    broker: MQTT_BROKER,
    devices: Object.values(DEVICES).map((d) => ({
      ...d,
      topics: {
        attrs: `/${APIKEY}/${d.deviceId}/attrs`,
        ...(d.commands ? { cmd: `/${APIKEY}/${d.deviceId}/cmd`, cmdexe: `/${APIKEY}/${d.deviceId}/cmdexe` } : {}),
      },
    })),
  });
});

app.get('/api/health', route(async (_req, res) => {
  res.json({ backend: { ok: true }, ...(await fiware.health()) });
}));

app.post('/api/test', route(async (_req, res) => {
  await house.hardwareTest();
  res.json({ ok: true });
}));

/* -------- Erros -------- */
app.use((err, _req, res, _next) => {
  const offline = fiware.isOffline(err);
  const status = offline ? 503 : err.status || 500;
  if (status >= 500) console.error(err.message);
  res.status(status).json({
    error: offline ? 'FIWARE fora do ar — o docker compose está rodando?' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`Backend da Casinha em http://localhost:${PORT}  (Orion: ${ORION_URL})`);
  house.start();
});
