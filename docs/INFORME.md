# AJRO HOUSE: informe de la transformación de la tienda

**Fecha:** 20 de noviembre de 2026
**Rama de trabajo:** `rediseno-tienda` (no publicada todavía)
**Copia de seguridad del sitio original:** rama `backup/sitio-original-2026-11-20`

> **Estado:** todo el código está terminado y probado en local, incluida una base de datos PostgreSQL real que ejecuta el mismo esquema que Supabase. **Para que el panel y el inventario funcionen en internet, tú debes crear el proyecto de Supabase** (unos 15 minutos, ver sección F). Mientras no lo hagas, la tienda pública funciona en modo catálogo con los 91 perfumes actuales.

---

## A. Problemas encontrados

| # | Problema | Archivo | Consecuencia |
|---|----------|---------|--------------|
| 1 | El botón "PEDIR POR WHATSAPP" de la sección Contacto apuntaba a `https://wa.me/` **sin número**. | `index.html` | El cliente abría WhatsApp sin ningún chat del negocio. |
| 2 | El mensaje del pedido se armaba con `%0A` y luego se volvía a codificar con `encodeURIComponent`. | `script.js` | Los saltos de línea llegaban como el texto literal "%0A". El pedido se veía desordenado. |
| 3 | Productos guardados a mano en `products.json`, identificados por su **posición** en la lista (`products[item.index]`). | `script.js`, `products.json` | Agregar un perfume obligaba a editar código. Si cambiaba el orden del archivo, el carrito podía apuntar a otro perfume. |
| 4 | Tres registros vacíos al final del catálogo, con categoría pero sin nombre ni precio. | `products.json` | Aparecían tarjetas vacías en la tienda. |
| 5 | Publicaciones duplicadas: "212 MEN NYC" / "212 MEN NYC EDT" y dos "D&G LIGHT BLUE SUMMER VIBES". | `products.json` | El mismo perfume aparecía dos veces. |
| 6 | No había control de existencias. Los productos "PRÓXIMAMENTE" solo se marcaban en el nombre del archivo de imagen. | `products.json`, `script.js` | Se podían pedir perfumes agotados o que aún no llegaban. |
| 7 | Los datos se insertaban con `innerHTML` sin escapar (nombre, descripción, ruta de imagen). | `script.js` | Riesgo de inyección de código (XSS) en cuanto los datos vengan de un panel o de Excel. |
| 8 | El carrito vivía solo en memoria. | `script.js` | Se vaciaba al recargar o al salir de la página. |
| 9 | La búsqueda distinguía acentos (`toLowerCase` sin normalizar). | `script.js` | "arabe" no encontraba "Árabe". |
| 10 | El orden por precio usaba solo el precio de la botella. | `script.js` | Los productos que solo tienen decant no se ordenaban bien. |
| 11 | Solo existían los filtros Masculinos/Femeninos y decants. No había filtros por marca, tipo, precio ni disponibilidad. | `index.html`, `script.js` | La navegación era difícil con más de 90 perfumes. |
| 12 | El nombre de la marca no era consistente: "AJRO Perfumes" en unos lugares y "AJRO HOUSE" en otros. | `index.html` | Restaba profesionalismo. |
| 13 | Errores de ortografía y redacción: "Haz tu pedido!" sin signo de apertura, "Bote sellado", "DAVID OFF", "COLD WATER", "GOODESS", "SILLAGET", "ONE MILLON". "Valentino Born in Roma 50ml" tenía la descripción "100 ml". | `index.html`, `script.js`, `products.json` | Imagen poco cuidada e información incorrecta. |
| 14 | Faltaban metadatos para buscadores y redes sociales, el favicon, `robots.txt` y el sitemap. | `index.html` | Mala vista previa al compartir el enlace y menor visibilidad en Google. |
| 15 | Imágenes pesadas: la foto de la categoría femenina pesaba 1.1 MB. No había carga diferida (lazy loading). | `images/`, `index.html` | La página cargaba lento en celulares. |
| 16 | Restos de código: un comentario decía que el botón "Aceptar" se había eliminado pero seguía en uso, y había variables sin usar (`parent`, `floatingCount`). | `script.js` | Mantenimiento confuso. |
| 17 | **El reporte de ventas `REPORTE_DE_VENTAS_AJRO_HOUSE OFICIAL.xlsx` está dentro del repositorio.** | raíz del proyecto | GitHub Pages lo publica: **cualquiera puede descargarlo** en `arey2026.github.io/REPORTE_DE_VENTAS_AJRO_HOUSE%20OFICIAL.xlsx`. Ver la sección "Pendientes". |

## B. Correcciones realizadas

| Archivo | Cambio | Motivo y beneficio |
|---------|--------|--------------------|
| `index.html` | Rediseño completo de la página: encabezado fijo, portada, categorías, secciones dinámicas, catálogo con filtros, decants, beneficios, contacto, pie de página, carrito lateral y ficha de producto. Se agregaron SEO, Open Graph, datos estructurados (JSON-LD) y una política de seguridad de contenido (CSP). | Imagen de lujo, navegación clara y mejor posicionamiento. |
| `css/store.css` (nuevo, reemplaza a `styles.css`) | Diseño en negro, dorado y marfil con Cormorant Garamond y Montserrat. Animaciones suaves, respeto de `prefers-reduced-motion` y diseño adaptable (escritorio, tablet y celular). | Diseño elegante y legible en todos los dispositivos. |
| `js/store.js` (nuevo, reemplaza a `script.js`) | Toda la lógica de la tienda: todo el contenido se escapa antes de mostrarse, el carrito se guarda en el navegador, los productos se identifican por SKU, se respeta la disponibilidad y el mensaje de WhatsApp se codifica una sola vez. | Corrige los problemas 2, 3, 7, 8 y 16. |
| `js/catalog.js`, `js/inventory.js`, `js/cart.js`, `js/utils.js` (nuevos) | Lógica separada en módulos que se pueden probar: búsqueda sin acentos, filtros, orden, disponibilidad y carrito. | Código organizado y cubierto por pruebas automáticas. |
| Sección Contacto | Todos los botones de WhatsApp usan el número que ya tenía el sitio (**50496278653**). | Corrige el problema 1. |
| Datos del catálogo | Migración automática (`scripts/legacy-migration.mjs`): SKU AJ-0001 a AJ-0093, marca, tipo (Diseñador o Árabe), tamaño de la botella, nombres corregidos y estado "Próximamente" para los 10 perfumes que lo indicaban en su imagen. Los 2 duplicados quedan **Inactivos** (no se borran) y se descartaron los 3 registros vacíos. | Corrige los problemas 4, 5, 6 y 13. No se inventaron precios: todos son los del archivo anterior. |
| Imágenes | Logo en WebP con fondo transparente (13 KB), favicon, imagen para redes sociales, fotos de categorías optimizadas (de 1.1 MB a 53 KB) y `loading="lazy"` en el catálogo. | Carga más rápida. |
| `package.json` | `"type": "module"`, scripts `test`, `build:excel` y `serve`. `create_decants_pdf.js` pasa a llamarse `.cjs` para que siga funcionando. | Herramientas de mantenimiento. |
| `.gitignore` | Se ignoran `REPORTE_DE_VENTAS*.xlsx` y `.claude/`. | Evita publicar por error nuevos reportes de ventas. |
| `robots.txt`, `sitemap.xml`, `.nojekyll` (nuevos) | Indexación correcta. `/admin/` queda excluido de los buscadores. | SEO. |

## C. Nuevas funcionalidades

**Tienda pública** (`index.html`)
- **Buscador** por nombre, marca, categoría o descripción. No distingue mayúsculas, minúsculas ni acentos, y admite varias palabras ("dior sauvage").
- **Filtros:** categoría (Masculino, Femenino, Unisex), tipo (Diseñador, Árabe, Nicho), marca (con conteo), presentación (botella, 5 ml, 10 ml), rango de precio, disponibilidad (todos, solo disponibles, próximamente), solo ofertas y solo favoritos. Los filtros activos aparecen como etiquetas que se quitan con un clic. En el celular los filtros se abren en un panel lateral.
- **Orden:** recomendados, precio (de menor a mayor y de mayor a menor), A–Z, Z–A y novedades.
- **Tarjeta de producto:** foto, marca, nombre, categoría y tipo, descripción, presentaciones con su precio, disponibilidad ("Disponible", "¡Últimas 2 unidades!", "Agotado", "Próximamente"), botón "Agregar" y "Detalles".
- **Ficha de producto** (con enlace para compartir, por ejemplo `?producto=AJ-0008`): foto grande, presentaciones con su disponibilidad, cantidad, favoritos, consulta por WhatsApp y **productos relacionados**.
- **Secciones automáticas** de la página principal: *Destacados*, *Ofertas*, *Nuevos lanzamientos* y *Los más vendidos*. Solo aparecen cuando hay datos reales: los más vendidos se calculan **únicamente con pedidos confirmados**.
- **Categorías** con conteo real y acceso directo al catálogo filtrado.
- **Favoritos** (corazón). Se guardan en el navegador del cliente.
- **Carrito** con varias presentaciones, cantidades, subtotales y total. Valida la disponibilidad (los decants de 5 y 10 ml comparten el mismo líquido) y se conserva al navegar o recargar.
- **Pedido por WhatsApp:** el mensaje incluye nombre, marca, presentación, cantidad, precio unitario, subtotal y total. Cuando la base de datos está activa, el pedido **se registra como pendiente** con un código (por ejemplo `AJ-261120-6943`) y los precios se recalculan en el servidor.
- Botón flotante de WhatsApp y aviso cuando el catálogo no puede cargar.

**Panel administrativo** (`/admin/`): explicado en las secciones D y E.
- **Resumen:** perfumes registrados, activos, agotados, con pocas existencias, botellas selladas, mililitros para decants, valor estimado del inventario (a precio de venta), pedidos pendientes y ventas confirmadas (solo con datos reales). También muestra las alertas de existencias y los movimientos recientes.
- **Productos:** búsqueda, filtros, alta, edición, eliminación, cambio rápido de estado (Activo, Inactivo o Próximamente) y marca de destacado.
- **Existencias:** tabla de botellas, mililitros, decants preparados y unidades vendibles, alertas, movimientos e historial filtrable.
- **Pedidos:** confirmar (descuenta las existencias) o cancelar (si ya estaba confirmado, las devuelve).
- **Excel:** plantilla, exportación, importación con vista previa y copia de seguridad (JSON o Excel).
- **Imágenes:** subida múltiple con optimización automática (máximo 1200 px, en WebP).

## D. Sistema de inventario: paso a paso

**Conceptos**
- **Botellas selladas:** botellas cerradas que se venden completas.
- **Líquido para decants (ml):** perfume de las botellas que ya abriste. Si tienes varias botellas abiertas, se suma todo.
- **Decants preparados:** frascos de 5 ml o 10 ml que ya están llenos.
- Decants disponibles de 5 ml = preparados de 5 ml + (ml ÷ 5). Decants disponibles de 10 ml = preparados de 10 ml + (ml ÷ 10). El sistema valida el total de mililitros cuando un pedido combina 5 ml y 10 ml.
- **Las botellas selladas y los mililitros nunca se mezclan.** Solo pasan de un lado al otro con la acción "Abrir botella".

**Registrar un perfume:** Productos → **+ Nuevo perfume**. El SKU se sugiere solo (por ejemplo AJ-0094). Completa nombre, marca, categoría, tipo, precios (deja vacía o en 0 la presentación que no vendas), tamaño de la botella y existencias iniciales. Sube la foto y pulsa **Guardar perfume**. El perfume aparece de inmediato en la tienda con sus filtros y presentaciones.

**Editarlo:** Productos → **Editar**. Puedes cambiar nombre, marca, precios, descripción, categoría, foto, descuento, estado, destacado y nuevo lanzamiento. Las existencias no se cambian desde aquí; usa **Inventario** para que el cambio quede en el historial.

**Eliminarlo:** Productos → **Eliminar** y confirma. Es definitivo, aunque el historial de movimientos se conserva. Si solo quieres ocultarlo, cambia su estado a **Inactivo** con el botón de estado.

**Actualizar existencias:** Existencias → **Movimiento**:
- **Entrada:** compras o reposiciones (suma).
- **Salida:** roturas, regalos o ventas fuera de la tienda (resta). No permite quedar en negativo.
- **Ajuste (conteo):** escribe la cantidad real contada y el sistema calcula la diferencia.

Cada movimiento queda en el **Historial** con fecha, tipo, cantidades, resultado y nota.

**Administrar decants:**
1. **Abrir botella:** resta 1 botella sellada y suma su contenido (por ejemplo 100 ml) al líquido. Para esto el perfume necesita tener registrado el tamaño de la botella.
2. **Preparar decants** (opcional): pasa líquido a frascos llenos. Por ejemplo, 2 × 5 ml resta 10 ml y suma 2 preparados.
3. Al **confirmar un pedido**, se usan primero los decants preparados y después el líquido.

**Controlar mililitros (ejemplo real probado):** botella de 100 ml abierta → 100 ml. Se confirma la venta de un decant de 5 ml → 95 ml. Se confirma uno de 10 ml → 85 ml. Si alguien pide más de lo disponible, la tienda lo limita y el servidor rechaza la confirmación.

**Pedidos y existencias:** un pedido enviado por WhatsApp queda **pendiente y no descuenta nada**. En **Pedidos** pulsa **Confirmar venta** cuando el cliente pague: en ese momento se validan y descuentan las existencias de forma atómica, con bloqueo en la base de datos. Si cancelas un pedido confirmado, se devuelve exactamente lo que se descontó.

> **Por qué no hay reservas temporales:** reservar existencias con cada pedido de WhatsApp bloquearía inventario por pedidos que nunca se concretan. Por eso el control se hace al **confirmar**: si dos clientes piden la última unidad, el primer pedido que confirmes se descuenta y el segundo muestra el mensaje "No se puede confirmar…", así que nunca hay sobreventa.

## E. Sistema Excel

**Dónde descargar la plantilla**
- Panel → **Excel** → **Descargar plantilla**. También está en `plantilla/Plantilla_Inventario_AJRO_HOUSE.xlsx`.
- Para la **primera carga** usa `plantilla/Inventario_Inicial_AJRO_HOUSE.xlsx`, que también se descarga desde el panel. Ya contiene tus 93 perfumes con su SKU, marca y precios.

**Antes de importar ese archivo, completa las celdas amarillas con tus existencias reales.** Si quedan vacías, los perfumes entran con 0 y se mostrarán como agotados.

**Hojas de la plantilla:** *Inventario* (los datos), *Instrucciones* (guía completa columna por columna) y *Listas* (oculta, alimenta las listas desplegables).

**Cómo llenar las columnas.** Las columnas con * y encabezado dorado son obligatorias para perfumes nuevos.

| Columna | Qué escribir |
|---|---|
| SKU * | Código único (por ejemplo AJ-0101). Si ya existe, el perfume se **actualiza**; si no, se **crea**. |
| Nombre del perfume *, Marca * | Texto. |
| Categoría * | Lista: Masculino, Femenino o Unisex. |
| Tipo de perfume * | Lista: Diseñador, Árabe o Nicho. |
| Descripción | Texto breve (opcional). |
| Precio botella sellada / decant 5 ml / decant 10 ml (L.) | Número. Escribe 0 si no vendes esa presentación. |
| Existencias botellas selladas | Número entero. |
| Decants 5 ml / 10 ml preparados | Frascos ya llenos (0 si los preparas al momento). |
| Mililitros disponibles para decants | Total de ml de las botellas abiertas. |
| Imagen (archivo o URL) | Ver "Cómo agregar fotografías". |
| Producto destacado | Sí o No. |
| Estado * | Activo, Inactivo o Próximamente. |
| Tamaño de botella (ml), Nuevo lanzamiento, Descuento (%), Alerta existencias bajas | Opcionales. |

**Reglas importantes**
- Una celda **vacía** en un perfume que ya existe significa "no cambiar". Así no se borra información por accidente. Para quitar una presentación, escribe 0 en su precio.
- El orden de las columnas puede cambiar, pero no cambies el texto de los encabezados.
- Formato de moneda en lempiras, filtros automáticos, validaciones y listas desplegables ya vienen configurados.

**Cómo agregar fotografías**
1. Panel → **Imágenes** → arrastra o elige las fotos. Se optimizan solas y te muestra el nombre final (por ejemplo `sauvage-edp.webp`).
2. Escribe ese nombre en la columna **Imagen**.

También puedes usar una ruta del sitio (`images/archivo.jpg`) o una URL `https://…`.

**Cómo importar**
1. Panel → **Excel** → **IMPORTAR INVENTARIO DESDE EXCEL** → elige el archivo `.xlsx`.
2. Revisa la **vista previa**: perfumes nuevos, perfumes modificados (cada cambio con su valor "antes → después"), sin cambios, errores (fila, SKU, columna y problema) y advertencias.
3. Si hay errores, corrígelos en Excel y vuelve a importar, o marca **"Importar solo las filas válidas"**.
4. Pulsa **Confirmar importación**. Todo se guarda en una sola operación: si algo falla, **no se guarda nada**.

**Actualizar productos existentes:** exporta, edita en Excel y vuelve a importar. Se actualizan por SKU, sin duplicados. Si el archivo es **antiguo** (hubo ventas o movimientos después de exportarlo) y cambia existencias, el panel te advierte y pide una confirmación extra para no sobrescribir ventas.

**Exportar:** Panel → Excel → **EXPORTAR INVENTARIO A EXCEL**. Descarga `Inventario_AJRO_HOUSE_AAAA-MM-DD.xlsx` con todo lo actual, listo para editar y reimportar.

**Errores de importación frecuentes**

| Mensaje | Solución |
|---|---|
| No se encontró la columna "SKU" | Usa la plantilla oficial y no cambies la fila 1. |
| SKU repetido en el archivo | Cada fila necesita un SKU distinto. |
| Valor no válido "…" en Categoría, Tipo o Estado | Usa las opciones de la lista desplegable (se aceptan minúsculas y sin acento). |
| Debe ser un número mayor o igual a 0 o un número entero | No escribas texto ni negativos en precios o existencias. |
| "Marca" es obligatorio para un perfume nuevo | Completa las columnas con *. |
| La foto "…" no está en la pestaña Imágenes | Súbela con ese mismo nombre (es una advertencia, no impide importar). |

## F. Configuración técnica

**Tecnologías**
- Sitio estático HTML, CSS y JavaScript con módulos ES. No necesita compilación y es 100 % compatible con GitHub Pages.
- **Base de datos: Supabase**, que incluye PostgreSQL, inicio de sesión de administradores, almacenamiento de fotos y reglas de seguridad por fila (RLS). Se eligió frente a Firebase porque las reglas de inventario (mililitros, pedidos, importación todo-o-nada) se implementan como funciones SQL **atómicas en el servidor**, sin necesidad de un backend propio.
- ExcelJS 4.4.0 (se carga solo en el panel), supabase-js 2.45.4 y Google Fonts.
- Herramientas locales: Node.js, ExcelJS y PGlite (PostgreSQL embebido para pruebas).

**Seguridad**
- Las reglas viven en `supabase/schema.sql`:
  - el público solo **lee** los productos que no están inactivos y solo puede **crear pedidos pendientes**, con precios recalculados en el servidor y límites de cantidad;
  - modificar productos, existencias, pedidos e importaciones exige una cuenta incluida en la tabla `admins`;
  - el historial y los pedidos son privados.
- La clave `anon` de `js/config.js` es pública por diseño. **Nunca** pongas la clave `service_role` en el sitio.
- Todo el contenido se escapa antes de mostrarse y hay una política CSP que limita los orígenes de scripts.

**Costos:** el plan gratuito de Supabase es suficiente para empezar (500 MB de base de datos y 1 GB de fotos). Ten en cuenta que **los proyectos gratuitos se pausan tras 7 días sin actividad**. Si eso pasa, la tienda muestra automáticamente el catálogo de referencia (`data/catalogo.json`) y tú reactivas el proyecto desde el panel de Supabase. El plan Pro (25 USD al mes) elimina las pausas.

**Configuración paso a paso (solo tú puedes hacerla, porque requiere crear una cuenta)**
1. Entra a <https://supabase.com>, crea una cuenta y luego **New project** (nombre: `ajro-house`, una región cercana como *East US*). Guarda la contraseña de la base de datos.
2. **SQL Editor** → **New query** → pega todo el contenido de `supabase/schema.sql` → **Run**. Debe decir *Success*.
3. **Authentication → Sign In / Providers → Email**: déjalo activado y **desactiva "Allow new users to sign up"** para que nadie más pueda crear cuentas.
4. **Authentication → Users → Add user → Create new user**: escribe tu correo y una contraseña segura, y marca *Auto Confirm User*. Copia el **User UID**.
5. **SQL Editor**, ejecuta (con tus datos):
   ```sql
   insert into public.admins (user_id, email) values ('PEGA-AQUÍ-EL-UID', 'tu-correo@ejemplo.com');
   ```
6. **Project Settings → API** (o **Data API**): copia *Project URL* y la clave *anon public* en `js/config.js`:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ...',
   ```
7. **Storage:** comprueba que exista el bucket `product-images` marcado como público. El script lo crea.
8. Prueba en tu computadora:
   ```bash
   npm install
   npm run serve
   ```
   Abre `http://localhost:8080/admin/`, inicia sesión e importa `Inventario_Inicial_AJRO_HOUSE.xlsx` (con las existencias completas).
9. **Publicación:** cuando lo apruebes, se fusiona la rama `rediseno-tienda` en `main` y se sube a GitHub. GitHub Pages publica en uno o dos minutos. Nada de esto se ha publicado todavía.

No hay variables de entorno: la única configuración es `js/config.js`, que contiene solo datos públicos.

**Mantenimiento**
- `npm test`: ejecuta las 20 pruebas automáticas.
- `npm run build:excel`: regenera la plantilla y el inventario inicial.
- `npm run serve`: servidor local.

## G. Pruebas realizadas

**Automáticas** (`npm test`): **20 de 20 aprobadas**. Usan PostgreSQL real (PGlite) con `supabase/schema.sql`.
- Seguridad: un visitante anónimo no puede crear productos ni ver pedidos o movimientos, y un usuario sin permiso de administrador no puede modificar el inventario.
- Mililitros: 100 → 95 → 85, con el historial exacto. No se puede vender más líquido del disponible. Dos pedidos que juntos superan las existencias: el segundo no se puede confirmar. Los decants preparados se consumen antes que el líquido y varias botellas suman su líquido. Al cancelar se devuelven las existencias. Las salidas no dejan cantidades negativas.
- Pedidos: precios y descuentos calculados en el servidor, y se rechazan los productos inactivos y próximamente.
- Excel: la plantilla tiene sus hojas, validaciones y formato en lempiras. Se importaron los 93 perfumes iniciales. Exportar, editar, ver la vista previa e importar actualiza por SKU sin duplicar, las celdas vacías no borran datos, una fila con errores cancela toda la importación y se detectan SKU repetidos, negativos y archivos sin la columna SKU.
- Tienda: búsqueda sin acentos, filtros, orden, productos relacionados, disponibilidad compartida entre 5 y 10 ml, carrito y mensaje de WhatsApp (sin doble codificación).

**En el navegador** (servidor local; panel y tienda en modo de pruebas con PGlite):
- Carga de la tienda (91 perfumes), navegación, buscador, filtros, ficha, productos relacionados, carrito (agregar, sumar, restar, eliminar, persistencia y límite por disponibilidad) y mensaje de WhatsApp con el número correcto.
- Panel: pantalla de configuración sin base de datos, inicio de sesión (rechaza una contraseña incorrecta), importación del Excel inicial desde el botón, alta de perfume con validaciones, edición, cambio de estado, movimientos (entrada, apertura de botella y salida bloqueada por falta de existencias), confirmación y cancelación de pedidos desde la interfaz, y exportación → edición → vista previa → importación parcial y advertencia de archivo antiguo.
- **El perfume agregado por Excel ("Nuevo Perfume Excel", AJ-0200) apareció en la tienda pública**, en "Destacados" y con su disponibilidad.
- Vista móvil (375 px): sin desbordes horizontales, 2 columnas, filtros en panel lateral y menú.

**Lo que NO pude probar (y por qué)**
- **Supabase real:** requiere que crees la cuenta (sección F). El esquema se probó en PostgreSQL 17 (PGlite) con roles y RLS equivalentes; Supabase usa PostgreSQL 15. Las funciones usadas son compatibles con ambos, pero conviene una prueba final cuando lo configures.
- **Subida de fotos a Supabase Storage:** en modo de pruebas las fotos se guardan solo en memoria. La subida real depende del bucket.
- **Apertura real de WhatsApp:** se verificó la URL y el mensaje exactos, pero no se abrió la aplicación.
- **Abrir la plantilla en Microsoft Excel:** se validó la estructura del archivo (hojas, validaciones, formatos y límites de texto de Excel) con ExcelJS, pero no se abrió en la aplicación de Excel. Te recomiendo abrirla una vez y avisarme si muestra algún aviso.
- Capturas de pantalla en móvil: parciales, porque la ventana estuvo minimizada. El diseño se verificó midiendo los elementos.

**Problemas encontrados durante las pruebas y ya corregidos:** los diálogos de confirmación del panel no se cerraban por la política CSP (`form-action`) y el evento `close` no llegaba en una pestaña en segundo plano. Se reescribió el diálogo sin depender de ellos. También se corrigieron: "¡Últimas 1 unidades!" (ahora "¡Última unidad!"), el parámetro `?producto=` borraba otros parámetros de la URL, el inventario inicial se marcaba como "exportado", y el logo mostraba un recuadro negro en el encabezado.

## H. Resumen de cambios

1. **Rediseño de lujo** en negro, dorado y marfil, adaptable a celulares. Antes la tienda no transmitía exclusividad y no funcionaba bien en pantallas pequeñas.
2. **Catálogo completo** con buscador sin acentos, 8 filtros, 6 órdenes, ficha de producto, productos relacionados, favoritos y secciones automáticas. Ahora es fácil encontrar un perfume entre más de 90.
3. **Base de datos Supabase** con seguridad en el servidor. GitHub Pages no puede guardar datos y `localStorage` no se comparte entre dispositivos.
4. **Panel administrativo** con autenticación. Agregar perfumes ya no requiere tocar código.
5. **Inventario real:** botellas y mililitros separados, apertura de botellas, decants preparados, historial y alertas. Esto evita sobreventas y permite controlar los decants.
6. **Pedidos registrados:** pendientes, confirmados o cancelados, con descuento de existencias solo al confirmar. Un mensaje de WhatsApp no es una venta confirmada.
7. **Integración con Excel:** plantilla profesional, importación por SKU con vista previa, exportación y copia de seguridad. Así puedes administrar 1 o 100 perfumes desde Excel.
8. **WhatsApp:** mensaje ordenado y número correcto en todos los botones. Antes había un botón sin número y los saltos de línea se veían como "%0A".
9. **Seguridad:** contenido escapado, CSP, RLS y protección del reporte de ventas en `.gitignore`.
10. **Rendimiento y SEO:** imágenes optimizadas, carga diferida, metadatos, Open Graph, sitemap y robots.
11. **Ortografía y textos:** se corrigieron los nombres de los perfumes y todos los textos visibles quedaron en español cuidado.
12. **Pruebas automáticas y documentación** para mantener el sistema con confianza.

## Pendientes que requieren tu decisión

1. **Crear el proyecto de Supabase** y pegar la URL y la clave en `js/config.js` (sección F).
2. **Completar las existencias** en `Inventario_Inicial_AJRO_HOUSE.xlsx` antes de la primera importación.
3. **Reporte de ventas público:** `REPORTE_DE_VENTAS_AJRO_HOUSE OFICIAL.xlsx` está en el repositorio. No lo borré. Te recomiendo quitarlo del repositorio (`git rm --cached`). Como ya está en el historial de Git, si contiene datos sensibles habría que limpiar el historial o hacer privado el repositorio.
4. Revisar las marcas asignadas automáticamente (columna Marca), los 2 duplicados que quedaron Inactivos y el estado "Próximamente" de 10 perfumes.
5. El PDF `catalogo-perfumes.pdf` sigue enlazado en el pie de página. Puede tener precios desactualizados.
6. Aprobar la publicación: fusionar la rama `rediseno-tienda` en `main` y hacer push.
