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
    expect(texto).toContain('FACTURA');
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

    // incluirQr por defecto es true: sin qrcode instalado, debe fallar con el mismo mensaje.
    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(SriError);
    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(
      /npm install pdfkit qrcode/,
    );
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

    const error: unknown = await generarRide({ documento: facturaFixture, claveAcceso }).catch((e) => e);

    expect(error).not.toBeInstanceOf(SriError);
    expect((error as { cause?: { message?: string } }).cause?.message).toContain(
      'fuente corrupta en el binario de qrcode',
    );
  });

  it('drawTotales omite "Total descuento" cuando TotalesRide.totalDescuento está ausente (fix round 1, hallazgo confirmado del reviewer)', async () => {
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
    expect(texto).not.toContain('Total descuento');
    expect(texto).toContain('VALOR TOTAL');
  });

  it('drawTotales sigue emitiendo "Total descuento" cuando sí está presente', async () => {
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
    expect(texto).toContain('Total descuento');
    expect(texto).toContain('5.00');
  });
});
