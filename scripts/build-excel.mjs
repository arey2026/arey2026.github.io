// Genera:
//  - plantilla/Plantilla_Inventario_AJRO_HOUSE.xlsx  (plantilla vacía)
//  - plantilla/Inventario_Inicial_AJRO_HOUSE.xlsx    (catálogo actual migrado, para la primera importación)
//  - data/catalogo.json                              (catálogo de respaldo mientras no haya base de datos)
// Uso: npm run build:excel
import ExcelJS from 'exceljs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorkbook, COLUMNS } from '../js/excel-schema.js';
import { migrateLegacy, loadLegacy } from './legacy-migration.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'plantilla'), { recursive: true });
mkdirSync(join(root, 'data'), { recursive: true });

// 1) Plantilla vacía
const empty = buildWorkbook(ExcelJS, []);
await empty.xlsx.writeFile(join(root, 'plantilla', 'Plantilla_Inventario_AJRO_HOUSE.xlsx'));

// 2) Inventario inicial a partir de products.json
const { products, notes } = migrateLegacy(loadLegacy(join(root, 'products.json')));
const initial = buildWorkbook(ExcelJS, products, { markExport: false });
const ws = initial.getWorksheet('Inventario');
const stockCols = ['stock_bottles', 'stock_5ml', 'stock_10ml', 'decant_ml'].map((k) => COLUMNS.findIndex((c) => c.key === k) + 1);
for (let r = 2; r <= ws.rowCount; r++) {
  for (const c of stockCols) {
    ws.getRow(r).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  }
}
ws.getRow(1).getCell(stockCols[0]).note = {
  texts: [{ text: 'COMPLETA las celdas amarillas con tus existencias reales antes de importar. Si quedan vacías se registrarán como 0 (agotado).' }],
};
await initial.xlsx.writeFile(join(root, 'plantilla', 'Inventario_Inicial_AJRO_HOUSE.xlsx'));

// 3) Catálogo de respaldo (sin control de existencias)
const fallback = products
  .filter((p) => p.status !== 'Inactivo')
  .map(({ stock_bottles, stock_5ml, stock_10ml, decant_ml, low_stock_threshold, ...rest }) => ({ ...rest, stock_tracking: false }));
writeFileSync(join(root, 'data', 'catalogo.json'), JSON.stringify(fallback, null, 1) + '\n');

console.log(`Plantilla vacía: OK`);
console.log(`Inventario inicial: ${products.length} perfumes`);
console.log(`Catálogo de respaldo: ${fallback.length} perfumes visibles`);
notes.forEach((n) => console.log('  - ' + n));
