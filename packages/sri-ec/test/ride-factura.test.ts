import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import type { NotaCredito } from '../src/documents/index.js';
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

  it('lanza un SriError claro si falta la dependencia opcional pdfkit', async () => {
    vi.doMock('pdfkit', () => {
      throw new Error('Cannot find module pdfkit');
    });
    const { generarRide, SriError } = await cargarRide();

    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(SriError);
    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(
      /npm install pdfkit qrcode/,
    );
  });

  it('lanza un SriError claro si falta la dependencia opcional qrcode', async () => {
    vi.doMock('qrcode', () => {
      throw new Error('Cannot find module qrcode');
    });
    const { generarRide, SriError } = await cargarRide();

    // incluirQr por defecto es true: sin qrcode instalado, debe fallar con el mismo mensaje.
    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(SriError);
    await expect(generarRide({ documento: facturaFixture, claveAcceso })).rejects.toThrow(
      /npm install pdfkit qrcode/,
    );
  });

  it('los 5 comprobantes aún no implementados lanzan un SriError anunciando la próxima versión', async () => {
    const { generarRide, SriError } = await cargarRide();

    // Cast deliberado: solo se necesita que `.tipo` sea el discriminante correcto
    // para ejercitar el despachador — `generarRide` lee `documento.tipo` y lanza
    // antes de tocar cualquier otro campo del documento.
    const notaCredito = { ...facturaFixture, tipo: TipoComprobante.NotaCredito } as unknown as NotaCredito;

    await expect(generarRide({ documento: notaCredito, claveAcceso })).rejects.toThrow(SriError);
    await expect(generarRide({ documento: notaCredito, claveAcceso })).rejects.toThrow(/próxima versión/);
  });
});
