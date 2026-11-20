// Convierte el catálogo anterior (products.json) al nuevo formato de
// inventario. Solo reorganiza datos existentes: no inventa precios ni
// existencias. Las existencias quedan VACÍAS para que el dueño las llene.
import { readFileSync } from 'node:fs';

// Marca de cada perfume del archivo anterior (mismo orden que products.json)
const BRANDS = [
  'Paco Rabanne', 'Valentino', 'Carolina Herrera', 'Giorgio Armani', 'Versace', 'Carolina Herrera', 'Dior', 'Dior',
  'Giorgio Armani', 'Ralph Lauren', 'Dolce & Gabbana', 'Carolina Herrera', 'Carolina Herrera', 'Armaf', 'Armaf',
  'Nautica', 'Nautica', 'Maison Alhambra', 'Antonio Banderas', 'Paco Rabanne', 'Davidoff', 'Paco Rabanne',
  'Paco Rabanne', 'Paco Rabanne', 'Dior', 'Dior', 'Carolina Herrera', 'Prada', 'Prada', 'Chanel', 'Chanel',
  'Carolina Herrera', 'Burberry', 'Carolina Herrera', 'Jean Paul Gaultier', 'Burberry', 'Burberry',
  'Tommy Hilfiger', 'Tommy Hilfiger', 'Davidoff', 'Carolina Herrera', 'Carolina Herrera', 'Carolina Herrera',
  'Paco Rabanne', 'Salvatore Ferragamo', 'Carolina Herrera', 'Carolina Herrera', 'Paco Rabanne', 'Paco Rabanne',
  'Paco Rabanne', 'Perry Ellis', 'Hugo Boss', 'Dolce & Gabbana', 'Carolina Herrera', 'Dolce & Gabbana', 'Armaf',
  'Azzaro', 'Valentino', 'Azzaro', 'Carolina Herrera', 'Ralph Lauren', 'Giorgio Armani', 'Versace',
  'Narciso Rodriguez', 'Viktor & Rolf', 'Azzaro', 'Versace', 'Dolce & Gabbana', 'Jean Paul Gaultier',
  'Giorgio Armani', 'Lacoste', 'Giorgio Armani', 'Tommy Hilfiger', 'Tommy Hilfiger', 'Armaf', 'Azzaro', 'Azzaro',
  'Dolce & Gabbana', 'Chanel', 'Guess', 'Lacoste', 'Valentino', 'Valentino', 'Valentino', 'Giorgio Armani',
  'Dolce & Gabbana', 'Versace', 'Giorgio Armani', 'Lacoste', 'Versace', 'Emir', 'Valentino', 'Moschino',
];
const ARAB_BRANDS = new Set(['Armaf', 'Maison Alhambra', 'Emir']);

// Correcciones ortográficas de nombres (texto original -> corregido)
const NAME_FIXES = {
  'DAVID OFF COOL WATER MEN EDT': 'DAVIDOFF COOL WATER MEN EDT',
  'COLD WATER WOMEN': 'COOL WATER WOMAN',
  'BURBERRY GOODESS INTENSE EDP': 'BURBERRY GODDESS INTENSE EDP',
  'CLUB DE NUIT SILLAGET ARMAF': 'ARMAF CLUB DE NUIT SILLAGE',
  'PACO RABANNE ONE MILLON EDT': 'PACO RABANNE ONE MILLION EDT',
  'SAUVAGE ELIXIR 100ML EDP': 'SAUVAGE ELIXIR',
  'FAHRENHEIT EDT 100ml': 'FAHRENHEIT EDT',
  'VALENTINO BORN IN ROMA 50ml EDP': 'VALENTINO BORN IN ROMA EDP WOMAN 50 ML',
  'STALLION53 100ML EDP': 'STALLION 53 EDP',
  'VERSACE EROS ENERGY EDP 3.4OZ': 'VERSACE EROS ENERGY EDP',
  'D&G LIGHT BLUE SUMMER VIBES 2.5OZ': 'D&G LIGHT BLUE SUMMER VIBES',
  'J.P.G.BELLE P.GARDEN EDP': 'JEAN PAUL GAULTIER LA BELLE PARADISE GARDEN EDP',
  'CHANEL No 5 100ML EDP': 'CHANEL N°5 EDP',
  'BLEU DE CHANEL PARFUM M': 'BLEU DE CHANEL PARFUM',
  'LIGHT BLUE D&G M EDT': 'D&G LIGHT BLUE POUR HOMME EDT',
  'MOSCHINO TOY BOY M EDP': 'MOSCHINO TOY BOY EDP',
  'GUESS SEDUCTIVE BLUE 4P': 'GUESS SEDUCTIVE BLUE SET 4 PIEZAS',
  'CLUB DE NUIT INTENSE SET 4P ARMAF': 'ARMAF CLUB DE NUIT INTENSE SET 4 PIEZAS',
  'PACO RABANNE INVICTUS PLATINUM SET 2P': 'PACO RABANNE INVICTUS PLATINUM SET 2 PIEZAS',
  'SIGNORINA MISTERIOSA 3P SET': 'SIGNORINA MISTERIOSA SET 3 PIEZAS',
  'ODYSSEY HOMME EDP': 'ARMAF ODYSSEY HOMME EDP',
  'ODYSSEY MANDARIN SKY EDP': 'ARMAF ODYSSEY MANDARIN SKY EDP',
};

// Tamaño real cuando la descripción anterior no coincidía con el nombre
const SIZE_FIXES = { 'VALENTINO BORN IN ROMA 50ml EDP': 50 };

// Publicaciones repetidas del mismo perfume: se dejan INACTIVAS (no se
// borran) para que no aparezcan dos veces en la tienda.
const DUPLICATE_OF = {
  '212 MEN NYC': '212 MEN NYC EDT',
  'D&G LIGHT BLUE SUMMER VIBES 2.5OZ': 'D&G LIGHT BLUE SUMMER VIBES',
};

function concentration(name) {
  const n = ` ${name.toUpperCase()} `;
  if (/\bSET\b/.test(n)) return 'Set de regalo';
  if (/\bELIXIR\b/.test(n)) return 'Elixir';
  if (/\bEDP\b/.test(n)) return 'Eau de Parfum';
  if (/\bEDT\b/.test(n)) return 'Eau de Toilette';
  if (/\bPARFUM\b/.test(n)) return 'Parfum';
  return '';
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function migrateLegacy(legacy) {
  const out = [];
  const notes = [];
  legacy.forEach((p, i) => {
    const original = String(p.name || '').trim();
    if (!original) { notes.push(`Registro ${i} sin nombre ni precio: descartado.`); return; }
    const brand = BRANDS[i];
    if (!brand) throw new Error(`Falta la marca del registro ${i} (${original})`);
    const name = NAME_FIXES[original] || original.replace(/\s+/g, ' ');
    const sizeMatch = String(p.description || '').match(/(\d+)\s*ml/i);
    const bottle_ml = SIZE_FIXES[original] || (sizeMatch ? Number(sizeMatch[1]) : null);
    const conc = concentration(name);
    const description = conc
      ? [conc, bottle_ml ? `${bottle_ml} ml` : ''].filter(Boolean).join(' · ')
      : (bottle_ml ? `Frasco de ${bottle_ml} ml` : '');
    const comingSoon = /PR[OÓ]XIMAMENTE/i.test(p.image || '');
    let status = comingSoon ? 'Próximamente' : 'Activo';
    if (DUPLICATE_OF[original]) {
      status = 'Inactivo';
      notes.push(`"${original}" duplicaba a "${DUPLICATE_OF[original]}": queda Inactivo.`);
    }
    out.push({
      sku: `AJ-${String(out.length + 1).padStart(4, '0')}`,
      name,
      brand,
      gender: p.category === 'Femeninos' ? 'Femenino' : 'Masculino',
      perfume_type: ARAB_BRANDS.has(brand) ? 'Árabe' : 'Diseñador',
      description: description ? description + '.' : '',
      bottle_ml,
      price_bottle: num(p.price_full ?? p.price),
      price_5ml: num(p.price_5ml),
      price_10ml: num(p.price_10ml),
      discount_pct: 0,
      stock_bottles: null,
      stock_5ml: null,
      stock_10ml: null,
      decant_ml: null,
      low_stock_threshold: 1,
      image: p.image || '',
      featured: false,
      is_new: false,
      status,
    });
  });
  return { products: out, notes };
}

export function loadLegacy(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}
