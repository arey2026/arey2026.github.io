// =====================================================================
// Capa de datos. Elige automáticamente la fuente:
//   1. Supabase (base de datos real)        -> si js/config.js está completo
//   2. Catálogo de respaldo data/catalogo.json (solo lectura, sin pedidos
//      registrados ni panel)                  -> si falta configurar Supabase
//   3. PGlite (PostgreSQL en el navegador)   -> SOLO pruebas locales en
//      localhost con ?backend=pglite. Nunca en el sitio publicado.
// =====================================================================
import { CONFIG, isBackendConfigured } from './config.js';

let backendPromise = null;

export function getBackend() {
  if (!backendPromise) backendPromise = createBackend();
  return backendPromise;
}

async function createBackend() {
  const params = new URLSearchParams(location.search);
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocal && (params.get('backend') === 'pglite' || sessionStorage.getItem('ajro-test-backend') === 'pglite')) {
    sessionStorage.setItem('ajro-test-backend', 'pglite');
    const m = await import('../tests/browser/pglite-backend.js');
    return m.createPgliteBackend();
  }
  if (isBackendConfigured()) {
    const m = await import('./backend-supabase.js');
    return m.createSupabaseBackend(CONFIG);
  }
  return createStaticBackend();
}

function notConfigured() {
  throw new Error('La base de datos aún no está configurada (ver docs/INFORME.md, sección F).');
}

export function createStaticBackend() {
  const root = new URL('../', import.meta.url);
  return {
    mode: 'static',
    storageBase: '',
    async listProducts() {
      const res = await fetch(new URL('data/catalogo.json', root), { cache: 'no-cache' });
      if (!res.ok) throw new Error('No se pudo cargar el catálogo.');
      return res.json();
    },
    async bestSellers() { return []; },
    async createOrder() { return null; }, // sin base de datos no se registra el pedido
    async getUser() { return null; },
    onAuthChange() {},
    signIn: notConfigured, signOut: notConfigured, isAdmin: async () => false,
  };
}
