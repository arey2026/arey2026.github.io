// Carrito: estado, validación de disponibilidad y mensaje de WhatsApp.
import { presentationsOf, checkCapacity, presentationByKey } from './inventory.js';
import { money } from './utils.js';

const STORAGE_KEY = 'ajro-carrito-v2';
export const MAX_QTY_PER_LINE = 20;

export function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((i) => i && i.sku && i.presentation && i.qty > 0) : [];
  } catch {
    return [];
  }
}

export function saveCart(items) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* modo privado */ }
}

/**
 * Une el carrito con el catálogo vigente: precios actuales, disponibilidad
 * y problemas por línea. Devuelve { lines, total, valid }.
 */
export function resolveCart(items, productsBySku) {
  const lines = items.map((item) => {
    const product = productsBySku.get(item.sku);
    const pres = product && presentationsOf(product).find((p) => p.key === item.presentation);
    const line = { ...item, product, pres, unitPrice: pres?.price ?? 0, subtotal: 0, problem: '' };
    if (!product || product.status === 'Inactivo') line.problem = 'Este perfume ya no está disponible.';
    else if (product.status === 'Próximamente') line.problem = 'Próximamente: aún no se puede pedir.';
    else if (!pres) line.problem = 'Esta presentación ya no está disponible.';
    else if (pres.available !== null && pres.available <= 0) line.problem = 'Agotado en esta presentación.';
    line.subtotal = line.problem ? 0 : line.unitPrice * item.qty;
    return line;
  });

  // Validación conjunta por producto (5 ml y 10 ml comparten líquido)
  const bySku = new Map();
  lines.filter((l) => !l.problem).forEach((l) => {
    const agg = bySku.get(l.sku) || { b: 0, s5: 0, s10: 0, product: l.product, lines: [] };
    if (l.presentation === 'botella') agg.b += l.qty;
    if (l.presentation === '5ml') agg.s5 += l.qty;
    if (l.presentation === '10ml') agg.s10 += l.qty;
    agg.lines.push(l);
    bySku.set(l.sku, agg);
  });
  bySku.forEach((agg) => {
    const msg = checkCapacity(agg.product, agg.b, agg.s5, agg.s10);
    if (msg) agg.lines.forEach((l) => { l.problem = 'La cantidad supera la disponibilidad actual.'; l.subtotal = 0; });
  });

  const total = lines.reduce((s, l) => s + l.subtotal, 0);
  return { lines, total, valid: lines.length > 0 && lines.every((l) => !l.problem) };
}

/** Máximo que se puede pedir de una línea considerando las demás del mismo perfume. */
export function maxQtyFor(items, sku, presentation, product) {
  const pres = presentationsOf(product).find((p) => p.key === presentation);
  if (!pres) return 0;
  if (pres.available === null) return MAX_QTY_PER_LINE;
  const others = items.filter((i) => i.sku === sku && i.presentation !== presentation);
  let max = 0;
  for (let q = 1; q <= MAX_QTY_PER_LINE; q++) {
    const all = [...others, { presentation, qty: q }];
    const sum = (k) => all.filter((i) => i.presentation === k).reduce((s, i) => s + i.qty, 0);
    if (checkCapacity(product, sum('botella'), sum('5ml'), sum('10ml'))) break;
    max = q;
  }
  return max;
}

/**
 * Mensaje de WhatsApp. `lines` puede venir del servidor (pedido registrado)
 * o del carrito local: {name, brand, label, qty, unit_price, subtotal}.
 */
export function buildWhatsAppMessage({ lines, total, code, customer, note, businessName = 'AJRO HOUSE' }) {
  const out = [];
  out.push(`Hola, ${businessName}. Me gustaría hacer el siguiente pedido:`);
  if (code) out.push(`Pedido N.º ${code}`);
  out.push('');
  lines.forEach((l, i) => {
    out.push(`${i + 1}) ${l.name}`);
    out.push(`   Marca: ${l.brand}`);
    out.push(`   Presentación: ${l.label}`);
    out.push(`   Cantidad: ${l.qty}`);
    out.push(`   Precio unitario: ${money(l.unit_price)}`);
    out.push(`   Subtotal: ${money(l.subtotal)}`);
    out.push('');
  });
  out.push(`TOTAL DEL PEDIDO: ${money(total)}`);
  if (customer) out.push(`Nombre: ${customer}`);
  if (note) out.push(`Comentario: ${note}`);
  out.push('');
  out.push('Quedo atento(a) a la confirmación de disponibilidad, forma de pago y entrega. ¡Gracias!');
  return out.join('\n');
}

export function cartLinesForMessage(resolved) {
  return resolved.lines.filter((l) => !l.problem).map((l) => ({
    name: l.product.name, brand: l.product.brand, label: presentationByKey(l.presentation).label,
    qty: l.qty, unit_price: l.unitPrice, subtotal: l.subtotal,
  }));
}

export function whatsappUrl(number, message) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
