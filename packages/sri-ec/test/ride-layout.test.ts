import { describe, expect, it } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import type { Comprobante, Factura, NotaCredito, Pago } from '../src/documents/index.js';
import { generarRide } from '../src/ride/index.js';
import { crearDocumentoRide } from '../src/ride/pdf-doc.js';
import { drawTotales } from '../src/ride/blocks.js';
import { generarClaveAcceso } from '../src/utils/clave-acceso.js';
import {
  facturaFixture,
  guiaRemisionFixture,
  liquidacionCompraFixture,
  notaCreditoFixture,
  notaDebitoFixture,
  retencionFixture,
} from './documents.test.js';

/**
 * Regresiones de PAGINACIÓN y LAYOUT del RIDE (auditoría previa a 0.2.0).
 *
 * A diferencia de `ride-factura.test.ts`/`ride-otros.test.ts` —que verifican
 * QUÉ texto sale— estos tests verifican DÓNDE sale: en qué página cae cada
 * cosa y con qué geometría se dibujaron los rectángulos. Todos fallaban antes
 * del fix de "medir y después dibujar" (`blocks.ts`), y cada uno reproduce un
 * hallazgo concreto de la auditoría:
 *
 * - Cajas que cruzaban de página: pdfkit paginaba solo a mitad de un bloque y
 *   el borde se cerraba con el `y` de la página nueva contra el de la vieja,
 *   dejando un rectángulo de alto NEGATIVO en la página equivocada y el
 *   bloque anterior sin borde ("VALOR TOTAL" solo en una página, "112.00" en
 *   la siguiente).
 * - Fila de tabla más alta que una página: las columnas de importes quedaban
 *   huérfanas en la página siguiente, fuera del rectángulo de su fila, y sin
 *   repetir el encabezado.
 * - Bloques lado a lado con el mismo `y`: si el de la izquierda saltaba de
 *   página, el de la derecha se dibujaba en ese `y` viejo sobre la página
 *   nueva.
 * - Etiqueta envuelta a dos líneas pisada por la fila siguiente.
 */

const claveAcceso = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.Factura,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000001',
  codigoNum: '12345678',
});

/** Igual que `claveAcceso`, para los otros 5 tipos (mismos parámetros que `ride-otros.test.ts`). */
function clavePara(tipoComprobante: TipoComprobante, numero: string): string {
  return generarClaveAcceso({
    fecha: '03/08/2026',
    tipoComprobante,
    ruc: '1790011001001',
    ambiente: '1',
    serie: '001001',
    numero,
    codigoNum: '12345678',
  });
}

const claveLiquidacionCompra = clavePara(TipoComprobante.LiquidacionCompra, '000000002');
const claveNotaCredito = clavePara(TipoComprobante.NotaCredito, '000000003');
const claveNotaDebito = clavePara(TipoComprobante.NotaDebito, '000000004');
const claveGuiaRemision = clavePara(TipoComprobante.GuiaRemision, '000000005');
const claveRetencion = clavePara(TipoComprobante.Retencion, '000000006');

/** `n` copias de `modelo`, cada una pasada por `ajustar` para diferenciarla. */
function repetir<T>(modelo: T, n: number, ajustar: (modelo: T, indice: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => ajustar(modelo, i));
}

/** Un fragmento de texto del PDF, con su posición ya en coordenadas "desde arriba" (como las de pdfkit). */
interface ItemTexto {
  texto: string;
  x: number;
  y: number;
}

/** Un rectángulo dibujado (operador `re`), en las mismas coordenadas que pdfkit lo emitió. */
interface RectPdf {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

interface PaginaPdf {
  numero: number;
  ancho: number;
  alto: number;
  items: ItemTexto[];
  rects: RectPdf[];
  /** Todo el texto de la página, unido por espacios (mismo criterio que los otros tests de RIDE). */
  texto: string;
}

/**
 * Extrae texto CON POSICIÓN y todos los rectángulos de cada página.
 *
 * Los rectángulos salen del `OperatorList` de pdfjs: pdfkit los emite dentro
 * de un `constructPath`, así que hay que recorrer los sub-operadores y
 * consumir 4 coordenadas por cada `OPS.rectangle` (2 por `moveTo`/`lineTo`, 6
 * por `curveTo`). Es la técnica con la que la auditoría encontró los
 * rectángulos de alto negativo.
 *
 * pdfjs se queda con el `ArrayBuffer` que se le pasa (lo transfiere al
 * "worker"), así que se le entrega siempre una copia: los bytes originales
 * siguen siendo usables por el test.
 */
async function analizarPdf(pdfBytes: Uint8Array): Promise<PaginaPdf[]> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { OPS } = pdfjsLib;
  const documento = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;

  const paginas: PaginaPdf[] = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const pagina = await documento.getPage(i);
    const [, , ancho, alto] = pagina.view;

    const contenido = await pagina.getTextContent();
    const items: ItemTexto[] = [];
    for (const item of contenido.items) {
      if (!('str' in item)) continue;
      const transform = (item as { transform: number[] }).transform;
      // `transform[5]` viene en el espacio del PDF (origen abajo); se pasa a
      // "desde arriba" para poder compararlo con los rectángulos de pdfkit.
      items.push({ texto: item.str, x: transform[4], y: alto - transform[5] });
    }

    const rects: RectPdf[] = [];
    const ops = await pagina.getOperatorList();
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (ops.fnArray[k] !== OPS.constructPath) continue;
      const [subOps, coords] = ops.argsArray[k] as [number[], number[]];
      let c = 0;
      for (const op of subOps) {
        if (op === OPS.rectangle) {
          rects.push({ x: coords[c], y: coords[c + 1], ancho: coords[c + 2], alto: coords[c + 3] });
          c += 4;
        } else if (op === OPS.moveTo || op === OPS.lineTo) {
          c += 2;
        } else if (op === OPS.curveTo) {
          c += 6;
        }
      }
    }

    paginas.push({
      numero: i,
      ancho,
      alto,
      items,
      rects,
      texto: items.map((item) => item.texto).join(' '),
    });
  }
  return paginas;
}

/**
 * Todo rectángulo dibujado tiene alto y ancho POSITIVOS y cabe dentro de su
 * página. Es la aserción que atrapa el bug raíz: un borde cerrado con el `y`
 * de otra página producía `rect(..., alto ≈ −670)`, y una fila de tabla más
 * alta que el papel producía un `rect` de 1046 pt en una página de 841.
 */
function esperarRectangulosSanos(paginas: PaginaPdf[]): void {
  for (const pagina of paginas) {
    for (const rect of pagina.rects) {
      expect(
        rect.alto,
        `pág ${pagina.numero}: rectángulo de alto no positivo ${JSON.stringify(rect)}`,
      ).toBeGreaterThan(0);
      expect(
        rect.ancho,
        `pág ${pagina.numero}: rectángulo de ancho no positivo ${JSON.stringify(rect)}`,
      ).toBeGreaterThan(0);
      // Medio punto de tolerancia: el trazo tiene grosor y pdfkit redondea a 1e-6.
      expect(rect.y, `pág ${pagina.numero}: rectángulo por encima del papel ${JSON.stringify(rect)}`).toBeGreaterThan(
        -0.5,
      );
      expect(
        rect.y + rect.alto,
        `pág ${pagina.numero}: rectángulo que se sale del papel ${JSON.stringify(rect)}`,
      ).toBeLessThanOrEqual(pagina.alto + 0.5);
    }
  }
}

/** Un importe con 2 decimales, tal y como los imprime `formatMonto`. */
const IMPORTE = /^-?\d+\.\d{2}$/;

/**
 * Cada etiqueta de importe va acompañada de su valor EN LA MISMA PÁGINA y EN
 * LA MISMA LÍNEA. Antes, `escribirLinea` hacía dos `doc.text` independientes:
 * si el primero disparaba el salto de página implícito de pdfkit, la etiqueta
 * se quedaba en una página y el importe aparecía solo en la siguiente.
 */
function esperarEtiquetasConSuImporte(paginas: PaginaPdf[], etiquetas: string[]): void {
  for (const pagina of paginas) {
    for (const item of pagina.items) {
      if (!etiquetas.includes(item.texto.trim())) continue;
      const acompanante = pagina.items.find(
        (otro) => otro !== item && Math.abs(otro.y - item.y) < 1 && IMPORTE.test(otro.texto.trim()),
      );
      expect(
        acompanante,
        `pág ${pagina.numero}: "${item.texto}" quedó sin su importe (y=${item.y})`,
      ).toBeDefined();
    }
  }
}

/** Hay un rectángulo que envuelve `(x, y)` — es decir, ese texto está dentro de una caja con borde. */
function tieneBordeAlrededor(pagina: PaginaPdf, x: number, y: number): boolean {
  return pagina.rects.some(
    (rect) => rect.x <= x && x <= rect.x + rect.ancho && rect.y <= y && y <= rect.y + rect.alto,
  );
}

/** Busca el primer item cuyo texto contenga `fragmento`, junto con la página en la que está. */
function localizar(paginas: PaginaPdf[], fragmento: string): { pagina: PaginaPdf; item: ItemTexto } | undefined {
  for (const pagina of paginas) {
    const item = pagina.items.find((i) => i.texto.includes(fragmento));
    if (item) return { pagina, item };
  }
  return undefined;
}

/** Factura con `nDetalles` líneas de detalle (y, opcionalmente, N formas de pago e info adicional propia). */
function facturaCon(nDetalles: number, opciones: { pagos?: number; infoAdicional?: Record<string, string> } = {}) {
  const base = facturaFixture.detalles[0];
  const pagos: Pago[] = opciones.pagos
    ? Array.from({ length: opciones.pagos }, () => ({ ...facturaFixture.pagos[0] }))
    : facturaFixture.pagos;
  const factura: Factura = {
    ...facturaFixture,
    detalles: Array.from({ length: nDetalles }, (_, i) => ({
      ...base,
      codigoPrincipal: `PROD${String(i + 1).padStart(3, '0')}`,
      descripcion: `Servicio de consultoría ${i + 1}`,
    })),
    pagos,
    infoAdicional: opciones.infoAdicional ?? facturaFixture.infoAdicional,
  };
  return factura;
}

/** Nota de crédito con `nDetalles` líneas de detalle (segundo tipo del barrido). */
function notaCreditoCon(nDetalles: number): NotaCredito {
  const base = notaCreditoFixture.detalles[0];
  return {
    ...notaCreditoFixture,
    detalles: Array.from({ length: nDetalles }, (_, i) => ({
      ...base,
      codigoPrincipal: `PROD${String(i + 1).padStart(3, '0')}`,
      descripcion: `Servicio devuelto ${i + 1}`,
    })),
  };
}

/**
 * Las 6 líneas de información adicional con las que la auditoría reprodujo el
 * caso peor: con 31 detalles, la caja de totales caía justo en el borde de la
 * página y partía "VALOR TOTAL" de su importe.
 */
const INFO_ADICIONAL_6 = {
  Email: 'cliente@example.com',
  Telefono: '0999999999',
  Direccion: 'Calle Falsa 123, Quito',
  Vendedor: 'Ana Torres',
  Observacion: 'Entrega en bodega',
  OrdenCompra: 'OC-2026-0001',
};

/** Etiquetas del bloque de totales que SIEMPRE deben ir con su importe al lado. */
const ETIQUETAS_TOTALES = [
  'VALOR TOTAL',
  'Subtotal sin impuestos',
  'Total descuento',
  'IVA',
  'Propina',
  'ICE',
];

describe('ride: paginación y layout', () => {
  it('31 detalles + 6 campos de información adicional: ninguna caja cruza de página ni parte "VALOR TOTAL" de su importe', async () => {
    const pdf = await generarRide({
      documento: facturaCon(31, { infoAdicional: INFO_ADICIONAL_6 }),
      claveAcceso,
    });
    const paginas = await analizarPdf(pdf);

    // Antes del fix: 4 páginas, la 2ª con la cadena "VALOR TOTAL" y NADA más,
    // la 3ª empezando por un "112.00" suelto sobre un rectángulo vacío de
    // alto −670.795, y la 4ª con otro de −672.033.
    esperarRectangulosSanos(paginas);
    esperarEtiquetasConSuImporte(paginas, ETIQUETAS_TOTALES);

    // Ninguna página se queda con la etiqueta a solas.
    for (const pagina of paginas) {
      if (pagina.texto.includes('VALOR TOTAL')) {
        expect(pagina.texto).toContain(facturaFixture.importeTotal);
      }
    }

    // Y los 6 campos de información adicional salen todos, bajo su título.
    const todo = paginas.map((p) => p.texto).join('\n');
    for (const [clave, valor] of Object.entries(INFO_ADICIONAL_6)) {
      expect(todo).toContain(`${clave}: ${valor}`);
    }
    expect(todo).toContain('INFORMACIÓN ADICIONAL');
  });

  it('barrido de 20 a 45 filas (factura): rectángulos sanos y etiquetas con su importe en todas las páginas', async () => {
    for (let filas = 20; filas <= 45; filas++) {
      const paginas = await analizarPdf(
        await generarRide({ documento: facturaCon(filas, { infoAdicional: INFO_ADICIONAL_6 }), claveAcceso }),
      );
      esperarRectangulosSanos(paginas);
      esperarEtiquetasConSuImporte(paginas, ETIQUETAS_TOTALES);
      // El detalle completo sigue estando, fila por fila.
      const todo = paginas.map((p) => p.texto).join('\n');
      expect(todo, `con ${filas} filas`).toContain(`Servicio de consultoría ${filas}`);
    }
  }, 60_000);

  it('barrido de 20 a 45 filas (nota de crédito): rectángulos sanos y etiquetas con su importe en todas las páginas', async () => {
    for (let filas = 20; filas <= 45; filas++) {
      const paginas = await analizarPdf(
        await generarRide({ documento: notaCreditoCon(filas), claveAcceso: claveNotaCredito }),
      );
      esperarRectangulosSanos(paginas);
      esperarEtiquetasConSuImporte(paginas, ETIQUETAS_TOTALES);
      const todo = paginas.map((p) => p.texto).join('\n');
      expect(todo, `con ${filas} filas`).toContain(`Servicio devuelto ${filas}`);
    }
  }, 60_000);

  it('una fila de tabla más alta que una página: los importes van con su descripción y el encabezado se repite', async () => {
    const descripcion = Array.from({ length: 120 }, (_, i) => `linea-descripcion-${i + 1}`).join('\n');
    const documento: Factura = {
      ...facturaFixture,
      detalles: [{ ...facturaFixture.detalles[0], descripcion }],
    };

    const paginas = await analizarPdf(await generarRide({ documento, claveAcceso }));

    // Antes del fix: la fila se partía sola, las 3 columnas de importes
    // aparecían huérfanas al principio de la página siguiente (encima del
    // rectángulo de su fila) y no se repetía el encabezado.
    esperarRectangulosSanos(paginas);

    const inicioDescripcion = localizar(paginas, 'linea-descripcion-1');
    expect(inicioDescripcion).toBeDefined();
    const paginaInicio = inicioDescripcion!.pagina;

    // Los importes de la fila (cantidad, precio unitario, descuento, total)
    // están en la MISMA página en la que empieza su descripción.
    expect(paginaInicio.texto).toContain('100.00');
    expect(paginaInicio.texto).toContain('0.00');
    expect(paginaInicio.texto).toContain('1.00');

    // Toda página que continúe la descripción repite el encabezado de columnas.
    const paginasConDescripcion = paginas.filter((p) => p.texto.includes('linea-descripcion-'));
    expect(paginasConDescripcion.length).toBeGreaterThan(1);
    for (const pagina of paginasConDescripcion) {
      expect(pagina.texto, `pág ${pagina.numero} sin encabezado de tabla`).toContain('Descripción');
      expect(pagina.texto, `pág ${pagina.numero} sin encabezado de tabla`).toContain('P. Total');
    }

    // Nada se pierde: las 120 líneas siguen en el documento.
    const todo = paginas.map((p) => p.texto).join('\n');
    for (const n of [1, 60, 86, 87, 120]) {
      expect(todo).toContain(`linea-descripcion-${n}`);
    }

    // Y cada sub-fila tiene su propio borde alrededor de la descripción.
    for (const pagina of paginasConDescripcion) {
      const item = pagina.items.find((i) => i.texto.startsWith('linea-descripcion-'))!;
      expect(tieneBordeAlrededor(pagina, item.x, item.y), `pág ${pagina.numero}: fila sin borde`).toBe(true);
    }
  });

  it('30 detalles + 22 formas de pago: "FORMAS DE PAGO" y "TOTALES" caen en la misma página, ambos con borde', async () => {
    const paginas = await analizarPdf(
      await generarRide({ documento: facturaCon(30, { pagos: 22 }), claveAcceso }),
    );

    // Antes del fix: la caja de formas de pago se quedaba sin borde en la
    // página 1 (rect de alto −498.925 en la 2), las filas de pago seguían
    // arriba de la 2 dentro de una caja fantasma y TOTALES quedaba abajo a la
    // derecha de esa misma página, sin relación con su fila.
    esperarRectangulosSanos(paginas);

    const formasPago = localizar(paginas, 'FORMAS DE PAGO');
    const totales = localizar(paginas, 'TOTALES');
    expect(formasPago).toBeDefined();
    expect(totales).toBeDefined();
    expect(totales!.pagina.numero).toBe(formasPago!.pagina.numero);
    // Empiezan además en la misma línea: son una fila, no dos bloques sueltos.
    expect(Math.abs(totales!.item.y - formasPago!.item.y)).toBeLessThan(1);

    expect(tieneBordeAlrededor(formasPago!.pagina, formasPago!.item.x, formasPago!.item.y)).toBe(true);
    expect(tieneBordeAlrededor(totales!.pagina, totales!.item.x, totales!.item.y)).toBe(true);

    esperarEtiquetasConSuImporte(paginas, ETIQUETAS_TOTALES);
    // Las 22 formas de pago siguen ahí.
    const filasPago = paginas
      .flatMap((p) => p.items)
      .filter((i) => i.texto.includes('Sin utilización del sistema financiero'));
    expect(filasPago).toHaveLength(22);
  });

  it('una etiqueta que envuelve a varias líneas no queda pisada por la fila siguiente', async () => {
    // `codigoPorcentaje` fuera del catálogo: `drawTotales` imprime el código
    // crudo (nunca descarta un subtotal por no tener etiqueta conocida), y uno
    // largo envuelve a varias líneas. Antes, el avance vertical se tomaba del
    // IMPORTE (siempre 1 línea), así que la fila siguiente se dibujaba encima
    // de las líneas 2..n de la etiqueta.
    const { doc, finalizar } = await crearDocumentoRide('A4');
    drawTotales(
      doc,
      {
        impuestos: [
          {
            codigo: '2',
            codigoPorcentaje: 'CODIGO-DESCONOCIDO-MUY-LARGO-QUE-ENVUELVE-EN-VARIAS-LINEAS',
            baseImponible: '100.00',
            valor: '12.00',
          },
        ],
        totalSinImpuestos: '100.00',
        importeTotal: '112.00',
      },
      { x: 36, y: 36, width: 200 },
    );

    const paginas = await analizarPdf(await finalizar());
    expect(paginas).toHaveLength(1);
    const pagina = paginas[0];

    const yUltimaLineaEtiqueta = Math.max(
      ...pagina.items.filter((i) => i.texto.includes('LINEAS') || i.texto.includes('ENVUELVE')).map((i) => i.y),
    );
    const ySubtotalSinImpuestos = pagina.items.find((i) => i.texto.includes('Subtotal sin impuestos'))!.y;

    // La fila siguiente empieza POR DEBAJO de la última línea de la etiqueta
    // envuelta (antes: 770.188 vs 753.692 en coordenadas del PDF — es decir,
    // por encima, pisándola).
    expect(ySubtotalSinImpuestos).toBeGreaterThan(yUltimaLineaEtiqueta);
    esperarRectangulosSanos(paginas);
    esperarEtiquetasConSuImporte(paginas, ETIQUETAS_TOTALES);
  });

  it('un valor de información adicional más largo que una página se parte en cajas con borde, sin perder texto', async () => {
    // Caso extremo del bloque sin tabla: una sola línea más alta que el papel.
    // Se parte por palabras (nunca a mitad de palabra) y cada trozo va dentro
    // de su propia caja cerrada.
    const palabras = Array.from({ length: 1200 }, (_, i) => `palabra${i + 1}`).join(' ');
    const paginas = await analizarPdf(
      await generarRide({
        documento: facturaCon(1, { infoAdicional: { Observacion: palabras } }),
        claveAcceso,
      }),
    );

    esperarRectangulosSanos(paginas);
    const todo = paginas.map((p) => p.texto).join(' ');
    for (const n of [1, 600, 1200]) {
      expect(todo).toContain(`palabra${n}`);
    }
    // La caja se reabre con el título marcado como continuación.
    expect(todo).toContain('INFORMACIÓN ADICIONAL (continuación)');
  });

  /**
   * Los 4 tipos restantes, barridos igual que factura y nota de crédito: cada
   * uno apila bloques distintos (formas de pago, motivos, destinatarios,
   * documentos sustento), así que el punto en el que la caja caía sobre el
   * borde de la página es distinto en cada uno. La auditoría los encontró
   * repartidos por el rango 20–45 (guía 3 de 21 tamaños, retención 4 de 26).
   */
  const barridos: Array<[string, string, (filas: number) => Comprobante]> = [
    [
      'liquidación de compra',
      claveLiquidacionCompra,
      (filas) => ({
        ...liquidacionCompraFixture,
        detalles: repetir(liquidacionCompraFixture.detalles[0], filas, (d, i) => ({
          ...d,
          descripcion: `Compra ${i + 1}`,
        })),
        infoAdicional: INFO_ADICIONAL_6,
      }),
    ],
    [
      'nota de débito',
      claveNotaDebito,
      (filas) => ({
        ...notaDebitoFixture,
        motivos: repetir(notaDebitoFixture.motivos[0], filas, (m, i) => ({ ...m, razon: `Interés ${i + 1}` })),
        infoAdicional: INFO_ADICIONAL_6,
      }),
    ],
    [
      'guía de remisión',
      claveGuiaRemision,
      (filas) => ({
        ...guiaRemisionFixture,
        destinatarios: repetir(guiaRemisionFixture.destinatarios[0], 1, (d) => ({
          ...d,
          detalles: repetir(d.detalles[0], filas, (linea, j) => ({ ...linea, descripcion: `Bulto ${j + 1}` })),
        })),
        infoAdicional: INFO_ADICIONAL_6,
      }),
    ],
    [
      'retención',
      claveRetencion,
      (filas) => ({
        ...retencionFixture,
        docsSustento: repetir(retencionFixture.docsSustento[0], filas, (d, i) => ({
          ...d,
          numDocSustento: `001-001-${String(i + 1).padStart(9, '0')}`,
        })),
        infoAdicional: INFO_ADICIONAL_6,
      }),
    ],
  ];

  for (const [nombre, clave, construir] of barridos) {
    it(`barrido de 20 a 45 filas (${nombre}): rectángulos sanos en todas las páginas`, async () => {
      for (let filas = 20; filas <= 45; filas++) {
        const paginas = await analizarPdf(await generarRide({ documento: construir(filas), claveAcceso: clave }));
        esperarRectangulosSanos(paginas);
        esperarEtiquetasConSuImporte(paginas, ETIQUETAS_TOTALES);
        // La información adicional completa sobrevive al salto de página.
        const todo = paginas.map((p) => p.texto).join('\n');
        expect(todo, `${nombre} con ${filas} filas`).toContain('OrdenCompra: OC-2026-0001');
      }
    }, 60_000);
  }
});
