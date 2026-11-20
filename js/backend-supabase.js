// Implementación de la capa de datos con Supabase (PostgreSQL + Auth + Storage).
// Toda la seguridad se aplica en el servidor (RLS y funciones de supabase/schema.sql).
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const PRODUCT_FIELDS = ['sku', 'name', 'brand', 'gender', 'perfume_type', 'description', 'bottle_ml',
  'price_bottle', 'price_5ml', 'price_10ml', 'discount_pct', 'stock_bottles', 'stock_5ml', 'stock_10ml',
  'decant_ml', 'low_stock_threshold', 'image', 'featured', 'is_new', 'status'];

const pick = (obj) => Object.fromEntries(PRODUCT_FIELDS.filter((k) => k in obj).map((k) => [k, obj[k]]));

function check({ data, error }) {
  if (error) {
    const msg = error.message || 'Error desconocido';
    if (/JWT|session/i.test(msg)) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    if (error.code === '23505') throw new Error('Ya existe un producto con ese SKU.');
    throw new Error(msg);
  }
  return data;
}

export async function createSupabaseBackend(CONFIG) {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const bucket = CONFIG.STORAGE_BUCKET;
  const storageBase = `${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/`;

  return {
    mode: 'supabase',
    storageBase,

    // ---------- Público ----------
    async listProducts() {
      return check(await sb.from('products').select('*').order('name'));
    },
    async bestSellers(limit = 8) {
      return check(await sb.rpc('best_sellers', { p_limit: limit })) || [];
    },
    async createOrder(items, customer, note) {
      return check(await sb.rpc('create_order', { p_items: items, p_customer: customer || null, p_note: note || null }));
    },

    // ---------- Autenticación ----------
    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ?? null;
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (!error) return;
      const msg = error.message || '';
      if (/invalid login credentials/i.test(msg)) throw new Error('Correo o contraseña incorrectos.');
      if (/email not confirmed/i.test(msg)) throw new Error('El correo de este usuario no está confirmado en Supabase (Authentication → Users).');
      if (/invalid api key|no api key/i.test(msg)) throw new Error('La clave SUPABASE_ANON_KEY de js/config.js no es válida.');
      throw new Error(msg);
    },
    async signOut() { await sb.auth.signOut(); },
    async isAdmin() {
      return Boolean(check(await sb.rpc('is_admin')));
    },

    // ---------- Administración ----------
    async insertProduct(p) {
      return check(await sb.from('products').insert(pick(p)).select().single());
    },
    async updateProduct(id, p) {
      return check(await sb.from('products').update(pick(p)).eq('id', id).select().single());
    },
    async deleteProduct(id) {
      check(await sb.from('products').delete().eq('id', id));
    },
    async adjustStock(id, kind, d, note) {
      return check(await sb.rpc('adjust_stock', {
        p_product: id, p_kind: kind, p_bottles: d.bottles || 0, p_5ml: d.s5 || 0,
        p_10ml: d.s10 || 0, p_ml: d.ml || 0, p_note: note || null,
      }));
    },
    async openBottle(id, count, note) {
      return check(await sb.rpc('open_bottle', { p_product: id, p_count: count, p_note: note || null }));
    },
    async prepareDecants(id, size, count, note) {
      return check(await sb.rpc('prepare_decants', { p_product: id, p_size: size, p_count: count, p_note: note || null }));
    },
    async listMovements(limit = 300) {
      return check(await sb.from('inventory_movements').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    async countMovementsSince(date) {
      const { count, error } = await sb.from('inventory_movements').select('id', { count: 'exact', head: true })
        .gt('created_at', date.toISOString()).neq('kind', 'importacion');
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async listOrders(limit = 200) {
      return check(await sb.from('orders').select('*').order('created_at', { ascending: false }).limit(limit));
    },
    async confirmOrder(id) { return check(await sb.rpc('confirm_order', { p_order: id })); },
    async cancelOrder(id) { return check(await sb.rpc('cancel_order', { p_order: id })); },
    async importProducts(rows) { return check(await sb.rpc('import_products', { p_rows: rows })); },

    async uploadImage(file, name) {
      const { error } = await sb.storage.from(bucket).upload(name, file, {
        upsert: true, cacheControl: '31536000', contentType: file.type || undefined,
      });
      if (error) throw new Error(error.message);
      return name;
    },
    async listImages() {
      const all = [];
      for (let offset = 0; ; offset += 100) {
        const data = check(await sb.storage.from(bucket).list('', { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }));
        all.push(...data.filter((f) => f.id));
        if (data.length < 100) break;
      }
      return all.map((f) => ({ name: f.name, size: f.metadata?.size ?? 0 }));
    },
    async deleteImage(name) {
      check(await sb.storage.from(bucket).remove([name]));
    },
  };
}
