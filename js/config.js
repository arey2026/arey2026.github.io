// =====================================================================
// AJRO HOUSE · Configuración pública del sitio
// ---------------------------------------------------------------------
// SUPABASE_URL y SUPABASE_ANON_KEY se copian desde:
//   Supabase > Project Settings > API  ("Project URL" y "anon public").
// La clave "anon" es PÚBLICA por diseño: la seguridad la dan las reglas
// RLS de supabase/schema.sql. NUNCA pongas aquí la clave "service_role".
//
// Mientras SUPABASE_URL esté vacío, la tienda muestra el catálogo de
// respaldo data/catalogo.json (solo lectura) y el panel administrativo
// indicará que falta configurar la base de datos.
// =====================================================================
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // Número de WhatsApp del negocio (el mismo que ya usaba el sitio).
  WHATSAPP_NUMBER: '50496278653',

  STORAGE_BUCKET: 'product-images',
  BUSINESS_NAME: 'AJRO HOUSE',

  // Alerta cuando el líquido para decants baja de esta cantidad (ml).
  LOW_DECANT_ML: 20,
};

export const isBackendConfigured = () =>
  Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
