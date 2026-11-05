// Configuração central do backend.
export const PORT = Number(process.env.PORT) || 4000;
export const ORION_URL = process.env.ORION_URL || 'http://localhost:1026';
export const IOTA_URL = process.env.IOTA_URL || 'http://localhost:4041';
export const STH_URL = process.env.STH_URL || 'http://localhost:8666';

// Precisa ser igual à de fiwares/config.js e do casinha.ino
export const APIKEY = process.env.APIKEY || 'casinha-fiap-7k2q9';
export const MQTT_BROKER = process.env.MQTT_BROKER || 'broker.hivemq.com:1883';

export const FIWARE_HEADERS = {
  'fiware-service': 'casinha',
  'fiware-servicepath': '/',
};

export const POLL_MS = 1500; // frequência de leitura do Orion
export const COMMAND_TIMEOUT_MS = 15000; // tempo máximo para o ESP32 confirmar um comando
export const ESP32_OFFLINE_MS = 20000; // sem nenhum dado por esse tempo => ESP32 offline

// Todos os dispositivos ligados ao ESP32
export const DEVICES = {
  sensor: {
    key: 'sensor',
    deviceId: 'ldr001',
    entityId: 'urn:ngsi-ld:LuminositySensor:001',
    type: 'LuminositySensor',
    label: 'Sensor de luminosidade',
    hardware: 'LDR + resistor 10 kΩ',
    pin: 'GPIO 34',
    attrs: [{ objectId: 'l', name: 'luminosity', example: 'l|73' }],
  },
  lamp1: {
    key: 'lamp1',
    deviceId: 'lamp001',
    entityId: 'urn:ngsi-ld:Lamp:001',
    type: 'Lamp',
    label: 'Luz 1',
    hardware: 'LED + resistor 220 Ω',
    pin: 'GPIO 25',
    commands: ['on', 'off'],
    attrs: [{ objectId: 's', name: 'state', example: 's|on' }],
  },
  lamp2: {
    key: 'lamp2',
    deviceId: 'lamp002',
    entityId: 'urn:ngsi-ld:Lamp:002',
    type: 'Lamp',
    label: 'Luz 2',
    hardware: 'LED + resistor 220 Ω',
    pin: 'GPIO 26',
    commands: ['on', 'off'],
    attrs: [{ objectId: 's', name: 'state', example: 's|on' }],
  },
  lamp3: {
    key: 'lamp3',
    deviceId: 'lamp003',
    entityId: 'urn:ngsi-ld:Lamp:003',
    type: 'Lamp',
    label: 'Luz 3',
    hardware: 'LED + resistor 220 Ω',
    pin: 'GPIO 27',
    commands: ['on', 'off'],
    attrs: [{ objectId: 's', name: 'state', example: 's|on' }],
  },
  window: {
    key: 'window',
    deviceId: 'window001',
    entityId: 'urn:ngsi-ld:Window:001',
    type: 'Window',
    label: 'Janela',
    hardware: 'Servo motor SG90',
    pin: 'GPIO 13',
    commands: ['open', 'close'],
    attrs: [{ objectId: 's', name: 'state', example: 's|open' }],
  },
  clothesline: {
    key: 'clothesline',
    deviceId: 'clothesline001',
    entityId: 'urn:ngsi-ld:Clothesline:001',
    type: 'Clothesline',
    label: 'Varal',
    hardware: 'Servo motor SG90',
    pin: 'GPIO 33',
    commands: ['extend', 'retract'],
    attrs: [{ objectId: 's', name: 'state', example: 's|extended' }],
  },
};

export const LAMP_KEYS = ['lamp1', 'lamp2', 'lamp3'];
export const ACTUATOR_KEYS = [...LAMP_KEYS, 'window', 'clothesline'];

// Estado esperado depois de cada comando
export const COMMAND_TARGET = {
  on: 'on',
  off: 'off',
  open: 'open',
  close: 'closed',
  extend: 'extended',
  retract: 'retracted',
};

export const COMMAND_VERB = {
  on: 'acender',
  off: 'apagar',
  open: 'abrir',
  close: 'fechar',
  extend: 'estender',
  retract: 'recolher',
};

// Cenas prontas: [dispositivo, comando]
export const SCENES = [
  {
    id: 'bom-dia',
    name: 'Bom dia',
    icon: '🌅',
    actions: [['window', 'open'], ['clothesline', 'extend'], ['lamp1', 'off'], ['lamp2', 'off'], ['lamp3', 'off']],
  },
  {
    id: 'cheguei',
    name: 'Cheguei',
    icon: '🏡',
    actions: [['lamp1', 'on'], ['lamp3', 'on']],
  },
  {
    id: 'vai-chover',
    name: 'Vai chover',
    icon: '🌧️',
    actions: [['window', 'close'], ['clothesline', 'retract']],
  },
  {
    id: 'boa-noite',
    name: 'Boa noite',
    icon: '🌙',
    actions: [['window', 'close'], ['clothesline', 'retract'], ['lamp1', 'off'], ['lamp2', 'on'], ['lamp3', 'off']],
  },
  {
    id: 'sair',
    name: 'Sair de casa',
    icon: '🚪',
    actions: [['lamp1', 'off'], ['lamp2', 'off'], ['lamp3', 'off'], ['window', 'close'], ['clothesline', 'retract']],
  },
];

export const DEFAULT_SETTINGS = {
  lampNames: { lamp1: 'Sala', lamp2: 'Quarto', lamp3: 'Cozinha' },
  automation: {
    enabled: false,
    darkThreshold: 30,
    brightThreshold: 60,
    confirmSamples: 3,
    dark: { lamp1: 'on', lamp2: 'none', lamp3: 'on', window: 'close', clothesline: 'retract' },
    bright: { lamp1: 'off', lamp2: 'off', lamp3: 'off', window: 'none', clothesline: 'none' },
  },
};
