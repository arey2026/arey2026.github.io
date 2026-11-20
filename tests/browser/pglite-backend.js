// =====================================================================
// SOLO PARA PRUEBAS LOCALES (localhost + ?backend=pglite).
// Ejecuta el MISMO esquema supabase/schema.sql en un PostgreSQL embebido
// (PGlite) dentro del navegador, con roles anon/authenticated y RLS
// reales, para probar la tienda y el panel sin una cuenta de Supabase.
// Los datos se guardan en IndexedDB del navegador ("idb://ajro-pruebas").
// No se usa en el sitio publicado.
// =====================================================================
const PGLITE = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.3.15/dist/index.js';
const TEST_ADMIN = { id: '11111111-1111-1111-1111-111111111111', email: 'admin@ajro.test', password: 'prueba-local-123' };
const NUMERIC = ['price_bottle', 'price_5ml', 'price_10ml', 'decant_ml', 'total', 'decant_ml_delta', 'decant_ml_after', 'units'];

const norm = (row) => {
  const out = { ...row };
  NUMERIC.forEach((k) => { if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]); });
  return out;
};

export async function createPgliteBackend() {
  const { PGlite } = await import(PGLITE);
  const root = new URL('../../', import.meta.url);
  const db = new PGlite('idb://ajro-pruebas');
  const ready = await db.query(`select to_regclass('public.products') as t`);
  if (!ready.rows[0].t) {
    const [stub, schema] = await Promise.all([
      fetch(new URL('tests/supabase-stub.sql', root)).then((r) => r.text()),
      fetch(new URL('supabase/schema.sql', root)).then((r) => r.text()),
    ]);
    await db.exec(stub);
    await db.exec(schema);
    await db.query(`insert into auth.users values ($1, $2)`, [TEST_ADMIN.id, TEST_ADMIN.email]);
    await db.query(`insert into public.admins (user_id, email) values ($1, $2)`, [TEST_ADMIN.id, TEST_ADMIN.email]);
  }
  const images = new Map();
  const listeners = [];
  const uid = () => sessionStorage.getItem('ajro-test-uid');

  async function run(sql, params = []) {
    try {
      return await db.transaction(async (tx) => {
        const u = uid();
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u || '']);
        await tx.exec(`set local role ${u ? 'authenticated' : 'anon'}`);
        const r = await tx.query(sql, params);
        return r.rows.map(norm);
      });
    } catch (e) {
      throw new Error(e.message);
    }
  }
  const fn = async (sql, params) => (await run(sql, params))[0];
  const cols = (p) => Object.keys(p).filter((k) => k !== 'id' && !k.startsWith('_') && k !== 'stock_tracking'
    && !['created_at', 'updated_at'].includes(k));

  return {
    mode: 'pglite',
    storageBase: '',
    resolveTestImage: (name) => images.get(name) || '',

    listProducts: () => run('select * from products order by name'),
    bestSellers: (limit = 8) => run('select * from best_sellers($1)', [limit]),
    async createOrder(items, customer, note) {
      return (await fn('select create_order($1::jsonb, $2, $3) as r', [JSON.stringify(items), customer || null, note || null])).r;
    },

    async getUser() { return uid() ? { id: uid(), email: TEST_ADMIN.email } : null; },
    onAuthChange(cb) { listeners.push(cb); },
    async signIn(email, password) {
      if (email !== TEST_ADMIN.email || password !== TEST_ADMIN.password) throw new Error('Correo o contraseña incorrectos.');
      sessionStorage.setItem('ajro-test-uid', TEST_ADMIN.id);
      listeners.forEach((cb) => cb({ id: TEST_ADMIN.id, email }));
    },
    async signOut() { sessionStorage.removeItem('ajro-test-uid'); listeners.forEach((cb) => cb(null)); },
    async isAdmin() { return (await fn('select public.is_admin() as a')).a; },

    async insertProduct(p) {
      const k = cols(p);
      return fn(`insert into products (${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, k.map((x) => p[x]));
    },
    async updateProduct(id, p) {
      const k = cols(p);
      const r = await fn(`update products set ${k.map((x, i) => `${x} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...k.map((x) => p[x])]);
      if (!r) throw new Error('No autorizado o producto inexistente.');
      return r;
    },
    async deleteProduct(id) { await run('delete from products where id = $1', [id]); },
    adjustStock: (id, kind, d, note) => fn('select * from adjust_stock($1,$2,$3,$4,$5,$6,$7)', [id, kind, d.bottles || 0, d.s5 || 0, d.s10 || 0, d.ml || 0, note || null]),
    openBottle: (id, count, note) => fn('select * from open_bottle($1,$2,$3)', [id, count, note || null]),
    prepareDecants: (id, size, count, note) => fn('select * from prepare_decants($1,$2,$3,$4)', [id, size, count, note || null]),
    listMovements: (limit = 300) => run('select * from inventory_movements order by created_at desc, id desc limit $1', [limit]),
    async countMovementsSince(date) {
      return Number((await fn(`select count(*) c from inventory_movements where created_at > $1 and kind <> 'importacion'`, [date.toISOString()])).c);
    },
    listOrders: (limit = 200) => run('select * from orders order by created_at desc limit $1', [limit]),
    confirmOrder: (id) => fn('select * from confirm_order($1)', [id]),
    cancelOrder: (id) => fn('select * from cancel_order($1)', [id]),
    async importProducts(rows) { return (await fn('select import_products($1::jsonb) as r', [JSON.stringify(rows)])).r; },
    async uploadImage(file, name) { images.set(name, URL.createObjectURL(file)); return name; },
    async listImages() { return [...images.keys()].map((name) => ({ name, size: 0 })); },
    async deleteImage(name) { images.delete(name); },
  };
}
