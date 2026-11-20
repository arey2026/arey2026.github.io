// Filtros, búsqueda y orden del catálogo (funciones puras, probadas en tests/).
import { normalizeText } from './utils.js';
import { presentationsOf, lowestPrice, isSoldOut } from './inventory.js';

export const DEFAULT_FILTERS = Object.freeze({
  q: '', genders: [], types: [], brand: '', presentation: '', min: null, max: null,
  availability: 'all', // all | available | coming
  favoritesOnly: false, offersOnly: false, sort: 'recommended',
});

export function searchableText(p) {
  return normalizeText(`${p.name} ${p.brand} ${p.gender} ${p.perfume_type} ${p.description} ${p.sku}`);
}

export function filterProducts(products, f, favorites = new Set()) {
  const terms = normalizeText(f.q).split(' ').filter(Boolean);
  return products.filter((p) => {
    if (p.status === 'Inactivo') return false;
    if (terms.length) {
      const text = p._search || searchableText(p);
      if (!terms.every((t) => text.includes(t))) return false;
    }
    if (f.genders.length && !f.genders.includes(p.gender)) return false;
    if (f.types.length && !f.types.includes(p.perfume_type)) return false;
    if (f.brand && p.brand !== f.brand) return false;
    const pres = presentationsOf(p);
    if (f.presentation && !pres.some((x) => x.key === f.presentation)) return false;
    const from = lowestPrice(p);
    if (f.min !== null && f.min !== '' && from < Number(f.min)) return false;
    if (f.max !== null && f.max !== '' && from > Number(f.max)) return false;
    if (f.availability === 'available' && (p.status !== 'Activo' || isSoldOut(p))) return false;
    if (f.availability === 'coming' && p.status !== 'Próximamente') return false;
    if (f.favoritesOnly && !favorites.has(p.sku)) return false;
    if (f.offersOnly && !(Number(p.discount_pct) > 0)) return false;
    return true;
  });
}

const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

export function sortProducts(list, sort, bestSellerRank = new Map()) {
  const arr = [...list];
  switch (sort) {
    case 'price-asc': return arr.sort((a, b) => lowestPrice(a) - lowestPrice(b) || byName(a, b));
    case 'price-desc': return arr.sort((a, b) => lowestPrice(b) - lowestPrice(a) || byName(a, b));
    case 'name-asc': return arr.sort(byName);
    case 'name-desc': return arr.sort((a, b) => byName(b, a));
    case 'newest': return arr.sort((a, b) => (b.is_new - a.is_new) || String(b.created_at || '').localeCompare(String(a.created_at || '')) || byName(a, b));
    default: {
      // Recomendados: disponibles primero, luego destacados, nuevos, más vendidos y nombre
      const score = (p) => (p.status === 'Activo' && !isSoldOut(p) ? 8 : p.status === 'Próximamente' ? 2 : 0)
        + (p.featured ? 4 : 0) + (p.is_new ? 2 : 0) + (bestSellerRank.has(p.sku) ? 1 : 0);
      return arr.sort((a, b) => score(b) - score(a) || byName(a, b));
    }
  }
}

/** Productos relacionados: misma marca o mismo género y tipo. */
export function relatedProducts(product, products, limit = 4) {
  return products
    .filter((p) => p.sku !== product.sku && p.status !== 'Inactivo')
    .map((p) => ({ p, s: (p.brand === product.brand ? 3 : 0) + (p.gender === product.gender ? 2 : 0) + (p.perfume_type === product.perfume_type ? 1 : 0) + (isSoldOut(p) ? -2 : 0) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || byName(a.p, b.p))
    .slice(0, limit)
    .map((x) => x.p);
}

export function brandsOf(products) {
  const counts = new Map();
  products.filter((p) => p.status !== 'Inactivo').forEach((p) => counts.set(p.brand, (counts.get(p.brand) || 0) + 1));
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}
