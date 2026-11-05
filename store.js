// Persistência simples em arquivos JSON (pasta backend/data, fora do git).
import fs from 'node:fs';

const DIR = new URL('./data/', import.meta.url);
const timers = {};

export function load(name, fallback) {
  try {
    const raw = fs.readFileSync(new URL(name, DIR), 'utf8');
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

// Grava com pequeno atraso para juntar várias alterações seguidas
export function save(name, data) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(new URL(name, DIR), JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`Erro ao salvar ${name}:`, e.message);
    }
  }, 400);
}
