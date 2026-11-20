// Utilidades compartidas por la tienda, el panel y los scripts de Node.

/** Minúsculas, sin acentos y sin espacios repetidos: "Árabe " -> "arabe". */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Evita inyección de HTML al pintar datos que vienen de la base de datos o de Excel. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Formato de moneda en lempiras: 1234.5 -> "L. 1,234.50"; 1200 -> "L. 1,200". */
export function money(value) {
  const n = Number(value) || 0;
  const decimals = Number.isInteger(n) ? 0 : 2;
  return 'L. ' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
}

/** Convierte "L. 1,200.50", "1200" o 1200 a número. Devuelve null si está vacío o no es válido. */
export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim().replace(/^L\.?\s*/i, '').replace(/,/g, '').replace(/\s/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/**
 * Resuelve la ruta de una imagen de producto:
 *  - URL completa (https://...)        -> se usa tal cual
 *  - Ruta con carpeta (images/x.jpg)   -> relativa a la raíz del sitio
 *  - Solo nombre de archivo (x.jpg)    -> Supabase Storage (bucket de fotos)
 */
export function resolveImage(image, { siteRoot = './', storageBase = '' } = {}) {
  const v = String(image ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes('/')) return siteRoot + v.split('/').map(encodeURIComponent).join('/');
  if (storageBase) return storageBase + encodeURIComponent(v);
  return siteRoot + 'images/' + encodeURIComponent(v);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleString('es-HN', { dateStyle: 'medium', timeStyle: 'short' });
}
