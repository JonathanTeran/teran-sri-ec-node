import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import type { Factura } from '../src/documents/index.js';
import { generarClaveAcceso } from '../src/utils/clave-acceso.js';
import { facturaFixture } from './documents.test.js';

/**
 * Carga `generarRide` y `SriError` desde el MISMO registro de módulos de
 * vitest. Cada test llama a `vi.resetModules()` en `beforeEach` para que
 * `vi.doMock('pdfkit' | 'qrcode', …)` (Tests de dependencias ausentes, más
 * abajo) realmente intercepte el `import()` dinámico de `deps.ts` — pero eso
 * también reevalúa `errors/index.ts` como módulo nuevo. Si se comparara el
 * error lanzado contra un `SriError` importado de forma estática arriba (de
 * ANTES del reset), `instanceof` fallaría por identidad de clase entre dos
 * evaluaciones distintas del mismo módulo, no por un bug real — de ahí que
 * ambos se carguen siempre juntos, desde el registro fresco.
 */
async function cargarRide() {
  const { generarRide } = await import('../src/ride/index.js');
  const { SriError } = await import('../src/errors/index.js');
  return { generarRide, SriError };
}

/**
 * Carga `drawTotales` y `crearDocumentoRide` directamente por import
 * relativo (no vía el barrel público — `blocks.ts` es contrato interno para
 * Task 2, no API pública, ver `index.ts`). Se usa para probar
 * `TotalesRide.totalDescuento` opcional en aislamiento: hoy ningún
 * `*.ride.ts` puede producir un `TotalesRide` sin `totalDescuento` (Factura
 * lo modela obligatorio), así que la única forma de cubrir esa rama antes de
 * que Task 2 exista (NotaCredito/NotaDebito, que no lo modelan) es llamar al
 * bloque directamente.
 */
async function cargarBloqueTotales() {
  const { crearDocumentoRide } = await import('../src/ride/pdf-doc.js');
  const { drawTotales } = await import('../src/ride/blocks.js');
  return { crearDocumentoRide, drawTotales };
}

/**
 * Texto sin NINGÚN espacio en blanco. El nombre del documento se imprime con
 * espaciado entre letras (`F A C T U R A`, maqueta del Anexo 2, página 56) y
 * pdfjs lo extrae con esos espacios intercalados, así que comparar el nombre
 * "tal cual" fallaría aunque el PDF sea correcto. Comparar sin espacios
 * verifica exactamente lo que importa —que el nombre está impreso— sin
 * depender de cómo el extractor represente el espaciado.
 */
function sinEspacios(texto: string): string {
  return texto.replace(/\s+/g, '');
}

/**
 * Misma clave de acceso (mismos parámetros) que `test/xml-factura.test.ts`
 * usa para `facturaFixture` — 49 dígitos reales de Módulo 11, no un string
 * inventado, para que el test de extracción de texto verifique la clave que
 * de verdad iría en el XML de este mismo documento.
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

/**
 * Extrae el texto real de un PDF (todas las páginas) con `pdfjs-dist`
 * (devDependency, build "legacy" — es la que pdfjs recomienda para Node,
 * ver `docs/plans/2026-08-04-ride.md`). Es lo que hace que estos tests
 * verifiquen contenido real del RIDE en vez de solo el header `%PDF`.
 */
async function extraerTextoPdf(pdfBytes: Uint8Array): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

  const paginas: string[] = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const pagina = await documento.getPage(i);
    const contenido = await pagina.getTextContent();
    paginas.push(contenido.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return paginas.join('\n');
}

describe('ride: factura', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('pdfkit');
    vi.doUnmock('qrcode');
  });

  it('genera un PDF válido con el contenido real de la factura', async () => {
    const { generarRide } = await cargarRide();

    const pdf = await generarRide({
      documento: facturaFixture,
      claveAcceso,
      autorizacion: { numero: claveAcceso, fecha: '03/08/2026 10:00:00' },
    });

    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(0);
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');

    const texto = await extraerTextoPdf(pdf);

    // Emisor.
    expect(texto).toContain('COMERCIAL AMEPHIA S.A.');
    // Comprobante: RUC, nombre del documento, número `estab-ptoEmi-secuencial`, clave de acceso.
    expect(texto).toContain('1790011001001');
    expect(sinEspacios(texto)).toContain('FACTURA');
    expect(texto).toContain('001-001-000000001');
    expect(claveAcceso).toHaveLength(49);
    expect(texto).toContain(claveAcceso);
    // Autorizado: no debe aparecer el marcador de "no autorizado".
    expect(texto).not.toContain('NO AUTORIZADO');
    // Comprador.
    expect(texto).toContain('Juan Pérez');
    expect(texto).toContain('1710034065');
    // Detalle: cada descripción.
    for (const detalle of facturaFixture.detalles) {
      expect(texto).toContain(detalle.descripcion);
    }
    // Total.
    expect(texto).toContain(facturaFixture.importeTotal);
  });

  it('la columna "Cant." no parte una cantidad de 6 cifras a la mitad (hallazgo confirmado del reviewer)', async () => {
    const { generarRide } = await cargarRide();

    const facturaConCantidadGrande: Factura = {
      ...facturaFixture,
      detalles: [{ ...facturaFixture.detalles[0], cantidad: '999999.99' }],
    };

    const pdf = await generarRide({ documento: facturaConCantidadGrande, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    // `extraerTextoPdf` une los `TextItem` de pdfjs con un espacio: si
    // pdfkit hubiera partido "999999.99" en dos líneas ("999999." / "99",
    // el bug original con la columna a 0.07 de ancho), aparecerían como dos
    // `TextItem` separados y el texto extraído tendría un espacio en medio
    // ("999999. 99") en vez del valor contiguo.
    expect(texto).toContain('999999.99');
  });

  /**
   * Segunda ronda del mismo hallazgo que el test de arriba, encontrada en
   * la verificación independiente del fix de `formatCantidadPrecision`
   * (hallazgo 4): ensanchar `Cant.` de 0.07 a 0.085 alcanzaba para
   * `999999.99` (2 decimales, ≈ 35.4pt), pero `formatCantidadPrecision`
   * ahora puede imprimir hasta 6 — `123.123456` (≈ 39.6pt) volvía a
   * desbordar los ≈ 38pt de ancho útil a 0.085 y pdfkit la partía en dos
   * líneas ("123.12345" / "6"), la MISMA clase de bug con la cota de
   * caracteres movida. `DETALLE_COLUMN_SPECS` pasó `Cant.` a 0.12 (usable
   * ≈ 56pt, cabe el techo de 6 dígitos enteros documentado:
   * `999999.999999` ≈ 52.1pt).
   */
  it('la columna "Cant." no parte una cantidad de 6 decimales a la mitad (segunda ronda del hallazgo, tras formatCantidadPrecision)', async () => {
    const { generarRide } = await cargarRide();

    const facturaConCantidadAGranel: Factura = {
      ...facturaFixture,
      detalles: [
        { ...facturaFixture.detalles[0], codigoPrincipal: 'A', cantidad: '123.123456' },
        { ...facturaFixture.detalles[0], codigoPrincipal: 'B', cantidad: '1234.123456' },
      ],
    };

    const pdf = await generarRide({ documento: facturaConCantidadAGranel, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    // Si pdfkit hubiera partido el valor en dos líneas, `extraerTextoPdf`
    // (une los `TextItem` de pdfjs con un espacio) mostraría un espacio en
    // medio ("123.12345 6") en vez del valor contiguo.
    expect(texto).toContain('123.123456');
    expect(texto).toContain('1234.123456');
  });

  /**
   * Auditoría "campos fiscales omitidos", hallazgo 4 (HIGH): `cantidad` y
   * `precioUnitario` se formateaban con `formatMonto(valor, 2)` —que
   * REDONDEA a 2 decimales, no solo los muestra— así que un valor a granel
   * como `precioUnitario: '0.004500'` se imprimía como `0.00`
   * (aritméticamente imposible contra `precioTotalSinImpuesto`). Verificado
   * con mutación: revertir `celdasDetalle` a `formatMonto(d.cantidad, 2)` /
   * `formatMonto(d.precioUnitario, 2)` hace fallar este test (las 4
   * aserciones de abajo dejan de encontrar `'0.0045'`/`'0.001'` y en su
   * lugar aparece `'0.00'`).
   */
  it('cantidad/precioUnitario a granel se imprimen a la precisión real (hasta 6 decimales), sin redondear a 2 (hallazgo 4)', async () => {
    const { generarRide } = await cargarRide();

    const facturaAGranel: Factura = {
      ...facturaFixture,
      detalles: [
        {
          ...facturaFixture.detalles[0],
          codigoPrincipal: 'COMB001',
          descripcion: 'Combustible a granel',
          cantidad: '2000.000000',
          precioUnitario: '0.004500',
          precioTotalSinImpuesto: '9.00',
        },
        {
          ...facturaFixture.detalles[0],
          codigoPrincipal: 'ORO001',
          descripcion: 'Oro en polvo',
          cantidad: '0.001000',
          precioUnitario: '1000.000000',
          precioTotalSinImpuesto: '1.00',
        },
      ],
    };

    const pdf = await generarRide({ documento: facturaAGranel, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    // Fila 1: cantidad 2000 (sin ceros de cola sobrantes, mínimo 2
    // decimales) y precioUnitario 0.0045 (recortado de 6 a 4 decimales,
    // NUNCA redondeado a 0.00).
    expect(texto).toContain('2000.00');
    expect(texto).toContain('0.0045');
    // Fila 2: cantidad 0.001 (recortada de 6 a 3 decimales) y precioUnitario
    // 1000.00 (NUNCA redondeado a 1000, se mantiene el mínimo de 2 decimales).
    expect(texto).toContain('0.001');
    expect(texto).toContain('1000.00');
  });

  /** Ordinario (sin decimales a granel): sigue leyendo `1`/`100.00`, no `1.000000`/`100.000000` — hallazgo 4. */
  it('cantidad/precioUnitario enteros exactos se imprimen con 2 decimales, no con los 6 de la escala interna (hallazgo 4)', async () => {
    const { generarRide } = await cargarRide();

    const facturaOrdinaria: Factura = {
      ...facturaFixture,
      detalles: [
        {
          ...facturaFixture.detalles[0],
          cantidad: '1.000000',
          precioUnitario: '100.000000',
          precioTotalSinImpuesto: '100.00',
        },
      ],
    };

    const pdf = await generarRide({ documento: facturaOrdinaria, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('1.00');
    expect(texto).toContain('100.00');
    expect(texto).not.toContain('1.000000');
    expect(texto).not.toContain('100.000000');
  });

  it('renderiza dirEstablecimiento/contribuyenteEspecial en el bloque emisor cuando el documento los trae (fix round 1, gap real confirmado del reviewer)', async () => {
    const { generarRide } = await cargarRide();

    const facturaConDireccion: Factura = {
      ...facturaFixture,
      dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
      contribuyenteEspecial: '5368',
    };

    const pdf = await generarRide({ documento: facturaConDireccion, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('Av. Amazonas N24-03, Quito');
    expect(texto).toContain('5368');
  });

  it('el logo del emisor con bytes inválidos lanza un SriError claro en vez del error crudo de pdfkit (fix round 1, hallazgo confirmado del reviewer)', async () => {
    const { generarRide, SriError } = await cargarRide();

    const logoInvalido = new Uint8Array([1, 2, 3, 4, 5, 6]);

    await expect(generarRide({ documento: facturaFixture, claveAcceso, logo: logoInvalido })).rejects.toThrow(
      SriError,
    );
    await expect(generarRide({ documento: facturaFixture, claveAcceso, logo: logoInvalido })).rejects.toThrow(
      /PNG o JPG/,
    );
  });

  it('sin autorización: el RIDE se genera igual, marcado como no autorizado', async () => {
    const { generarRide } = await cargarRide();

    const pdf = await generarRide({ documento: facturaFixture, claveAcceso });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');

    const texto = await extraerTextoPdf(pdf);
    expect(texto).toContain('NO AUTORIZADO');
    expect(texto).toContain(claveAcceso);
  });

  it('opciones.incluirQr = false no genera el QR (no debe fallar aunque falte qrcode)', async () => {
    vi.doMock('qrcode', () => {
      throw new Error('Cannot find module qrcode');
    });
    const { generarRide } = await cargarRide();

    const pdf = await generarRide({
      documento: facturaFixture,
      claveAcceso,
      opciones: { incluirQr: false },
    });

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  /**
   * `.code = 'ERR_MODULE_NOT_FOUND'`: es el código real que Node pone en el
   * error cuando `await import('paquete-no-instalado')` falla porque el
   * paquete no existe en disco — `cargarPdfkit`/`cargarQrcode` (`deps.ts`)
   * solo reportan `RIDE_MISSING_DEPENDENCY` para ESTE código (o su variante
   * CJS `MODULE_NOT_FOUND`); cualquier otro error se relanza tal cual (fix
   * round, hallazgo confirmado del reviewer — ver el test de "falla por otra
   * razón" más abajo).
   */
  function mockModuloNoInstalado(mensaje: string): Error {
    const err = new Error(mensaje);
    (err as { code?: string }).code = 'ERR_MODULE_NOT_FOUND';
    return err;
  }

  it('lanza un SriError claro si falta la dependencia opcional pdfkit', async () => {
    vi.doMock('pdfkit', () => {
      throw mockModuloNoInstalado("Cannot find package 'pdfkit'");
    });
    const { generarRide, SriError } = await cargarRide();

    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(SriError);
    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(
      /npm install pdfkit qrcode/,
    );
  });

  it('lanza un SriError claro si falta la dependencia opcional qrcode', async () => {
    vi.doMock('qrcode', () => {
      throw mockModuloNoInstalado("Cannot find package 'qrcode'");
    });
    const { generarRide, SriError } = await cargarRide();

    // Desde 0.3.0 el predeterminado es el código de barras Code 128 (que solo
    // necesita pdfkit) y `incluirQr` es opt-in, así que el QR —y con él la
    // dependencia `qrcode`— solo se exige a quien la pide explícitamente.
    const conQr = { documento: facturaFixture, claveAcceso, opciones: { incluirQr: true } };
    await expect(generarRide(conQr)).rejects.toThrow(SriError);
    await expect(generarRide(conQr)).rejects.toThrow(/npm install pdfkit qrcode/);
  });

  /**
   * `vi.doMock`/`vi.mock` envuelven CUALQUIER error que lance su factory en
   * un `Error` propio de vitest (mensaje de diagnóstico genérico sobre
   * hoisting) con `cause: <el error real>` — pasa incluso si la factory
   * lanza sin relación alguna con hoisting, y con `vi.doMock` (no hoisted)
   * igual que con `vi.mock`. Por eso estos dos tests miran `.cause.message`
   * en vez de `.message`: es fiel a cómo se simula el fallo en la suite, no
   * a cómo Node lanza el error real en producción (ahí no hay envoltura).
   */
  it('si pdfkit falla al cargar por una razón que NO es "no instalado", propaga el error real en vez de reportarlo como dependencia faltante (hallazgo confirmado del reviewer)', async () => {
    // Sin `.code` de "no encontrado", como lanzaría una instalación
    // corrupta, una versión de Node incompatible, o una falla al cargar un
    // asset interno de pdfkit — nada de eso significa "el paquete no está
    // instalado".
    vi.doMock('pdfkit', () => {
      throw new Error('Unexpected token: fuente corrupta en el binario de pdfkit');
    });
    const { generarRide, SriError } = await cargarRide();

    const error: unknown = await generarRide({ documento: facturaFixture, claveAcceso }).catch((e) => e);

    // Específicamente NO debe ser el SriError de "instala la dependencia":
    // decirle a alguien que YA tiene pdfkit instalado que lo instale no
    // ayuda a diagnosticar una instalación corrupta.
    expect(error).not.toBeInstanceOf(SriError);
    expect((error as { cause?: { message?: string } }).cause?.message).toContain(
      'fuente corrupta en el binario de pdfkit',
    );
  });

  it('si qrcode falla al cargar por una razón que NO es "no instalado", propaga el error real en vez de reportarlo como dependencia faltante (hallazgo confirmado del reviewer)', async () => {
    vi.doMock('qrcode', () => {
      throw new Error('Unexpected token: fuente corrupta en el binario de qrcode');
    });
    const { generarRide, SriError } = await cargarRide();

    const error: unknown = await generarRide({
      documento: facturaFixture,
      claveAcceso,
      opciones: { incluirQr: true },
    }).catch((e) => e);

    expect(error).not.toBeInstanceOf(SriError);
    expect((error as { cause?: { message?: string } }).cause?.message).toContain(
      'fuente corrupta en el binario de qrcode',
    );
  });

  it('drawTotales omite "DESCUENTO" cuando TotalesRide.totalDescuento está ausente (fix round 1, hallazgo confirmado del reviewer)', async () => {
    const { crearDocumentoRide, drawTotales } = await cargarBloqueTotales();
    const { doc, finalizar } = await crearDocumentoRide('A4');

    drawTotales(
      doc,
      {
        // Simula el shape de NotaCredito/NotaDebito (Task 2): sin totalDescuento.
        impuestos: [{ codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '12.00' }],
        totalSinImpuestos: '100.00',
        importeTotal: '112.00',
      },
      { x: 36, y: 36, width: 250 },
    );

    const texto = await extraerTextoPdf(await finalizar());
    expect(texto).not.toContain('DESCUENTO');
    expect(texto).toContain('VALOR TOTAL');
  });

  it('drawTotales sigue emitiendo "DESCUENTO" cuando sí está presente', async () => {
    const { crearDocumentoRide, drawTotales } = await cargarBloqueTotales();
    const { doc, finalizar } = await crearDocumentoRide('A4');

    drawTotales(
      doc,
      {
        impuestos: [{ codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '12.00' }],
        totalSinImpuestos: '100.00',
        totalDescuento: '5.00',
        importeTotal: '107.00',
      },
      { x: 36, y: 36, width: 250 },
    );

    const texto = await extraerTextoPdf(await finalizar());
    expect(texto).toContain('DESCUENTO');
    expect(texto).toContain('5.00');
  });

  /**
   * Auditoría "campos fiscales omitidos", hallazgo 3 (CRITICAL):
   * `sumarValorPorCodigo`/las líneas de totales filtraban a `codigo ===
   * '2'` (IVA) y `'3'` (ICE) — cualquier otro código (IRBPNR, `'5'`, o uno
   * futuro no catalogado) se descartaba entero, así que las líneas
   * impresas no reconciliaban con `importeTotal`. Los valores de este test
   * son deliberadamente distintos entre sí (8.00/12.00/15.00) para que cada
   * aserción sea inequívoca. Verificado con mutación: revertir
   * `agruparValorPorCodigo`/`lineasTotales` a la versión que solo conocía
   * ICE/IVA hace fallar este test (ni "IRBPNR" ni "15.00" aparecen).
   */
  it('drawTotales imprime CADA código de impuesto presente (IRBPNR incluido) y las líneas reconcilian con importeTotal (hallazgo 3, CRÍTICO)', async () => {
    const { crearDocumentoRide, drawTotales } = await cargarBloqueTotales();
    const { doc, finalizar } = await crearDocumentoRide('A4');

    const subtotal = 100;
    const ice = 8;
    const iva = 12;
    const irbpnr = 15;
    const importeTotal = subtotal + ice + iva + irbpnr; // 135.00 — debe reconciliar.

    drawTotales(
      doc,
      {
        impuestos: [
          { codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: `${iva}.00` }, // IVA
          { codigo: '3', codigoPorcentaje: '3010', baseImponible: '50.00', valor: `${ice}.00` }, // ICE
          { codigo: '5', codigoPorcentaje: '0', baseImponible: '10.00', valor: `${irbpnr}.00` }, // IRBPNR
        ],
        totalSinImpuestos: `${subtotal}.00`,
        importeTotal: `${importeTotal}.00`,
      },
      { x: 36, y: 36, width: 250 },
    );

    const texto = await extraerTextoPdf(await finalizar());

    expect(texto).toContain('ICE');
    expect(texto).toContain('8.00');
    expect(texto).toContain('IVA');
    expect(texto).toContain('12.00');
    // IRBPNR: antes se descartaba entero — es la aserción que atrapa el bug raíz.
    expect(texto).toContain('IRBPNR');
    expect(texto).toContain('15.00');
    expect(texto).toContain('VALOR TOTAL');
    expect(texto).toContain('135.00');
    expect(subtotal + ice + iva + irbpnr).toBe(importeTotal);
  });

  it('drawTotales cae a una etiqueta genérica con el código crudo para un impuesto no catalogado (nunca lo descarta)', async () => {
    const { crearDocumentoRide, drawTotales } = await cargarBloqueTotales();
    const { doc, finalizar } = await crearDocumentoRide('A4');

    drawTotales(
      doc,
      {
        impuestos: [
          { codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '12.00' },
          { codigo: '99', codigoPorcentaje: '0', baseImponible: '10.00', valor: '3.00' },
        ],
        totalSinImpuestos: '100.00',
        importeTotal: '115.00',
      },
      { x: 36, y: 36, width: 250 },
    );

    const texto = await extraerTextoPdf(await finalizar());
    expect(texto).toContain('OTRO IMPUESTO (CÓDIGO 99)');
    expect(texto).toContain('3.00');
  });

  it('drawTotales imprime MONEDA cuando viene en TotalesRide (auditoría "campos fiscales omitidos": moneda nunca se leía)', async () => {
    const { crearDocumentoRide, drawTotales } = await cargarBloqueTotales();
    const { doc, finalizar } = await crearDocumentoRide('A4');

    drawTotales(
      doc,
      {
        impuestos: [{ codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '12.00' }],
        totalSinImpuestos: '100.00',
        importeTotal: '112.00',
        moneda: 'DOLAR',
      },
      { x: 36, y: 36, width: 250 },
    );

    const texto = await extraerTextoPdf(await finalizar());
    expect(texto).toContain('MONEDA');
    expect(texto).toContain('DOLAR');
  });

  /**
   * `moneda`/`tipoIdentificacionComprador` en `facturaFixture` ('DOLAR' y
   * '05' respectivamente) llegan hasta el PDF a través de
   * `factura.ride.ts` → `TotalesRide`/`CompradorRide` → `blocks.ts`.
   */
  it('propaga moneda y el tipo de identificación decodificado del comprador desde el documento real (facturaFixture)', async () => {
    const { generarRide } = await cargarRide();

    const pdf = await generarRide({ documento: facturaFixture, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    expect(texto).toContain('MONEDA');
    expect(texto).toContain(facturaFixture.moneda as string);
    // Etiqueta y valor van en columnas separadas de la banda del sujeto
    // (maqueta del Anexo 2), así que ya no salen unidos por dos puntos.
    expect(texto).toContain('Identificación:');
    expect(texto).toContain(`${facturaFixture.identificacionComprador} (Cédula de Identidad)`);
  });

  /**
   * Auditoría "campos fiscales omitidos" (item LOW): un `razonSocial` vacío
   * no debe dejar una etiqueta colgante ("Razón Social / Nombres:" sin
   * nada) — se omite la línea entera en vez de imprimir un `:` suelto.
   */
  it('un comprador con razonSocial vacía no deja la etiqueta "Razón Social / Nombres y Apellidos:" colgando sin valor', async () => {
    const { generarRide } = await cargarRide();

    const facturaSinNombreComprador: Factura = { ...facturaFixture, razonSocialComprador: '' };
    const pdf = await generarRide({ documento: facturaSinNombreComprador, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    expect(texto).not.toContain('Razón Social / Nombres y Apellidos:');
  });

  /**
   * Auditoría "campos fiscales omitidos" (item LOW): un `campoAdicional`
   * con valor vacío no debe dejar un `:` suelto bajo "INFORMACIÓN
   * ADICIONAL".
   */
  it('un campoAdicional con valor vacío no imprime su etiqueta (sin ":" suelto)', async () => {
    const { generarRide } = await cargarRide();

    const facturaConCampoVacio: Factura = {
      ...facturaFixture,
      infoAdicional: { ...facturaFixture.infoAdicional, Observacion: '' },
    };
    const pdf = await generarRide({ documento: facturaConCampoVacio, claveAcceso });
    const texto = await extraerTextoPdf(pdf);

    expect(texto).not.toContain('Observacion');
  });
});

/**
 * Conformidad con la maqueta OFICIAL del **Anexo 2** de la Ficha Técnica del
 * SRI (página 56, factura). A diferencia del resto de tests de este archivo
 * —que comprueban que los DATOS del documento llegan al PDF—, estos fijan las
 * ETIQUETAS LITERALES y el orden del formato oficial: si alguien vuelve a
 * redactar una fila "a su manera" (que es lo que hacía el RIDE v0.2.0), el
 * RIDE deja de parecerse a uno real y estos tests lo detectan.
 */
describe('ride: factura conforme al Anexo 2', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('pdfkit');
    vi.doUnmock('qrcode');
  });

  /** Rótulos literales de la cabecera y la banda del sujeto (maqueta p.56). */
  const ETIQUETAS_CABECERA = [
    'R.U.C.:',
    'No.',
    'NÚMERO DE AUTORIZACIÓN',
    'FECHA Y HORA DE AUTORIZACIÓN',
    'AMBIENTE:',
    'EMISIÓN:',
    'CLAVE DE ACCESO',
    'Dirección Matriz:',
    'OBLIGADO A LLEVAR CONTABILIDAD',
    'Razón Social / Nombres y Apellidos:',
    'Identificación:',
    'Fecha Emisión:',
  ];

  /**
   * Encabezados literales de la tabla de detalle (12 columnas de la maqueta).
   * Los tres primeros van ABREVIADOS: es lo que imprime la página 56, a
   * diferencia de la nota de crédito (57) y la liquidación de compra (61), que
   * los escriben enteros (ver `ride-otros.test.ts`).
   */
  const ENCABEZADOS_DETALLE = [
    'Cod. Principal',
    'Cod. Auxiliar',
    'Cant.',
    'Descripción',
    'Detalle Adicional',
    'Precio Unitario',
    'Subsidio',
    'Precio Sin Subsidio',
    'Descuento',
    'Precio Total',
  ];

  /** Filas literales del pie, en el orden de la maqueta. */
  const ETIQUETAS_PIE = [
    'Información Adicional',
    'Forma de Pago',
    'Valor',
    'SUBTOTAL IVA 0%',
    'SUBTOTAL NO OBJETO IVA',
    'SUBTOTAL EXENTO IVA',
    'SUBTOTAL SIN IMPUESTOS',
    'DESCUENTO',
    'PROPINA',
    'VALOR TOTAL',
    'VALOR TOTAL SIN SUBSIDIO',
    'AHORRO POR SUBSIDIO',
  ];

  it('imprime las etiquetas literales de la cabecera, el detalle y el pie', async () => {
    const { generarRide } = await cargarRide();

    const pdf = await generarRide({
      documento: facturaFixture,
      claveAcceso,
      autorizacion: { numero: claveAcceso, fecha: '03/08/2026 10:00:00' },
    });
    const texto = await extraerTextoPdf(pdf);
    const compacto = sinEspacios(texto);

    for (const etiqueta of [...ETIQUETAS_CABECERA, ...ENCABEZADOS_DETALLE, ...ETIQUETAS_PIE]) {
      // Sin espacios: varios rótulos ("Precio Sin Subsidio", "FECHA Y HORA DE
      // AUTORIZACIÓN") envuelven a dos o tres líneas dentro de su celda, igual
      // que en la maqueta, y pdfjs los extrae partidos.
      expect(compacto, `falta la etiqueta oficial "${etiqueta}"`).toContain(sinEspacios(etiqueta));
    }

    // Tres columnas `Detalle Adicional`, no una.
    expect(texto.match(/Detalle\s+Adicional/g)?.length).toBe(3);

    // El porcentaje del IVA sale del `codigoPorcentaje` del documento
    // (`'4'` = 15%), no está escrito a fuego: las maquetas de 2017 dicen 12%.
    expect(compacto).toContain(sinEspacios('SUBTOTAL 15%'));
    expect(compacto).toContain(sinEspacios('IVA 15%'));
  });

  it('el nombre del documento va con espaciado entre letras ("F A C T U R A")', async () => {
    const { generarRide } = await cargarRide();

    const texto = await extraerTextoPdf(await generarRide({ documento: facturaFixture, claveAcceso }));

    // pdfjs materializa el `characterSpacing` como espacios reales entre
    // glifos: si alguien quitara el espaciado, esta cadena desaparecería.
    expect(texto).toContain('F A C T U R A');
  });

  it('sin autorización, la cabecera conserva el rótulo oficial y marca el comprobante como no autorizado', async () => {
    const { generarRide } = await cargarRide();

    const texto = await extraerTextoPdf(await generarRide({ documento: facturaFixture, claveAcceso }));

    expect(texto).toContain('NÚMERO DE AUTORIZACIÓN');
    expect(texto).toContain('COMPROBANTE NO AUTORIZADO');
    // Sin autorización no hay fecha que imprimir: la fila no queda colgando.
    expect(texto).not.toContain('FECHA Y HORA DE AUTORIZACIÓN');
  });

  it('los 49 dígitos de la clave se imprimen íntegros bajo el código de barras, sin partirse', async () => {
    const { generarRide } = await cargarRide();

    const texto = await extraerTextoPdf(await generarRide({ documento: facturaFixture, claveAcceso }));

    // La clave no tiene espacios donde pdfkit pueda cortar: si la celda fuera
    // estrecha y no se encogiera la fuente, saldría partida en dos `TextItem`
    // y el texto extraído tendría un espacio en medio.
    expect(texto).toContain(claveAcceso);
  });
});
