import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import type {
  GuiaRemision,
  LiquidacionCompra,
  NotaCredito,
  NotaDebito,
  Retencion,
} from '../src/documents/index.js';
import { ValidationError } from '../src/errors/index.js';
import { generarClaveAcceso } from '../src/utils/clave-acceso.js';
import { GuiaRemisionXmlSerializer } from '../src/xml/guia-remision.serializer.js';
import { serializerFor } from '../src/xml/index.js';
import { LiquidacionCompraXmlSerializer } from '../src/xml/liquidacion-compra.serializer.js';
import { NotaCreditoXmlSerializer } from '../src/xml/nota-credito.serializer.js';
import { NotaDebitoXmlSerializer } from '../src/xml/nota-debito.serializer.js';
import { RetencionXmlSerializer } from '../src/xml/retencion.serializer.js';
import { FacturaXmlSerializer } from '../src/xml/factura.serializer.js';
import {
  facturaFixture,
  guiaRemisionFixture,
  liquidacionCompraFixture,
  notaCreditoFixture,
  notaDebitoFixture,
  retencionFixture,
} from './documents.test.js';

/**
 * Fixtures dorados generados por el paquete PHP real
 * (`scripts/gen-fixtures.php` en la raíz del repo). Regenerar con:
 *
 *   php scripts/gen-fixtures.php
 *
 * y commitear los XML resultantes. Ver ese script para el detalle exacto de
 * qué subconjunto de cada `*Fixture` (de `documents.test.ts`) es
 * representable en la API v2 de PHP — en los 5 casos, `infoAdicional` es el
 * único campo no representable (ningún value object v2 de PHP lo modela).
 */
function readGolden(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}.xml`, import.meta.url)), 'utf8');
}

const goldenLiquidacionCompra = readGolden('liquidacion-compra');
const goldenNotaCredito = readGolden('nota-credito');
const goldenNotaDebito = readGolden('nota-debito');
const goldenGuiaRemision = readGolden('guia-remision');
const goldenRetencion = readGolden('retencion');

/** Colapsa espacios en blanco entre etiquetas (mismo criterio que `xml-factura.test.ts`). */
function normalizeXml(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

const claveLiquidacionCompra = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.LiquidacionCompra,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000002',
  codigoNum: '12345678',
});

const claveNotaCredito = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.NotaCredito,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000003',
  codigoNum: '12345678',
});

const claveNotaDebito = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.NotaDebito,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000004',
  codigoNum: '12345678',
});

const claveGuiaRemision = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.GuiaRemision,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000005',
  codigoNum: '12345678',
});

const claveRetencion = generarClaveAcceso({
  fecha: '03/08/2026',
  tipoComprobante: TipoComprobante.Retencion,
  ruc: '1790011001001',
  ambiente: '1',
  serie: '001001',
  numero: '000000006',
  codigoNum: '12345678',
});

/**
 * `*Golden`: el `*Fixture` correspondiente (de `documents.test.ts`) sin
 * `infoAdicional` — el único campo que ninguno de los 5 value objects v2 de
 * PHP modela, así que es el único que hay que desactivar para reproducir
 * exactamente el fixture dorado generado por PHP.
 */
const liquidacionCompraGolden: LiquidacionCompra = {
  ...liquidacionCompraFixture,
  infoAdicional: undefined,
};
const notaCreditoGolden: NotaCredito = { ...notaCreditoFixture, infoAdicional: undefined };
const notaDebitoGolden: NotaDebito = { ...notaDebitoFixture, infoAdicional: undefined };
const guiaRemisionGolden: GuiaRemision = { ...guiaRemisionFixture, infoAdicional: undefined };
const retencionGolden: Retencion = { ...retencionFixture, infoAdicional: undefined };

describe('LiquidacionCompraXmlSerializer', () => {
  it('la clave de acceso calculada coincide con la usada por scripts/gen-fixtures.php', () => {
    expect(claveLiquidacionCompra).toBe('0308202603179001100100110010010000000021234567815');
  });

  it('serializa liquidacionCompraGolden idéntico (normalizado) al fixture dorado generado por PHP', () => {
    const xml = new LiquidacionCompraXmlSerializer().serialize(
      liquidacionCompraGolden,
      claveLiquidacionCompra,
    );

    expect(normalizeXml(xml)).toBe(normalizeXml(goldenLiquidacionCompra));
  });

  it('emite el elemento raíz <liquidacionCompra id="comprobante" version="1.1.0">', () => {
    const xml = new LiquidacionCompraXmlSerializer().serialize(
      liquidacionCompraGolden,
      claveLiquidacionCompra,
    );

    expect(xml).toContain('<liquidacionCompra id="comprobante" version="1.1.0">');
  });

  it('respeta el orden de elementos infoTributaria → infoLiquidacionCompra → detalles', () => {
    const xml = new LiquidacionCompraXmlSerializer().serialize(
      liquidacionCompraGolden,
      claveLiquidacionCompra,
    );

    const iTributaria = xml.indexOf('<infoTributaria>');
    const iInfo = xml.indexOf('<infoLiquidacionCompra>');
    const iDetalles = xml.indexOf('<detalles>');

    expect(iTributaria).toBeGreaterThan(-1);
    expect(iInfo).toBeGreaterThan(iTributaria);
    expect(iDetalles).toBeGreaterThan(iInfo);
  });

  it('es determinista', () => {
    const s = new LiquidacionCompraXmlSerializer();
    const a = s.serialize(liquidacionCompraFixture, claveLiquidacionCompra);
    const b = s.serialize(liquidacionCompraFixture, claveLiquidacionCompra);

    expect(a).toBe(b);
  });
});

describe('LiquidacionCompraXmlSerializer — campos opcionales no representables en PHP v2 (o no cubiertos por el fixture)', () => {
  it('emite infoTributaria/agenteRetencion e infoTributaria/contribuyenteRimpe, después de dirMatriz', () => {
    const doc: LiquidacionCompra = {
      ...liquidacionCompraFixture,
      infoTributaria: {
        ...liquidacionCompraFixture.infoTributaria,
        agenteRetencion: '30',
        contribuyenteRimpe: 'CONTRIBUYENTE RÉGIMEN RIMPE',
      },
    };
    const xml = new LiquidacionCompraXmlSerializer().serialize(doc, claveLiquidacionCompra);

    expect(xml).toContain('<agenteRetencion>30</agenteRetencion>');
    expect(xml).toContain('<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>');
    const iDirMatriz = xml.indexOf('<dirMatriz>');
    const iAgente = xml.indexOf('<agenteRetencion>');
    const iRimpe = xml.indexOf('<contribuyenteRimpe>');
    expect(iAgente).toBeGreaterThan(iDirMatriz);
    expect(iRimpe).toBeGreaterThan(iAgente);
  });

  it('emite totalConImpuestos[].descuentoAdicional entre codigoPorcentaje y baseImponible', () => {
    const doc: LiquidacionCompra = {
      ...liquidacionCompraFixture,
      totalConImpuestos: [
        { ...liquidacionCompraFixture.totalConImpuestos[0]!, descuentoAdicional: '2.50' },
      ],
    };
    const xml = new LiquidacionCompraXmlSerializer().serialize(doc, claveLiquidacionCompra);

    expect(xml).toContain('<descuentoAdicional>2.50</descuentoAdicional>');
    const iCodPorc = xml.indexOf('<codigoPorcentaje>');
    const iDesc = xml.indexOf('<descuentoAdicional>');
    const iBase = xml.indexOf('<baseImponible>');
    expect(iDesc).toBeGreaterThan(iCodPorc);
    expect(iBase).toBeGreaterThan(iDesc);
  });

  it('emite detalles[].detallesAdicionales entre precioTotalSinImpuesto e impuestos', () => {
    const doc: LiquidacionCompra = {
      ...liquidacionCompraFixture,
      detalles: [
        {
          ...liquidacionCompraFixture.detalles[0]!,
          detallesAdicionales: { Color: 'Amarillo', Marca: 'ACME' },
        },
      ],
    };
    const xml = new LiquidacionCompraXmlSerializer().serialize(doc, claveLiquidacionCompra);

    expect(xml).toContain('<detAdicional nombre="Color" valor="Amarillo"/>');
    expect(xml).toContain('<detAdicional nombre="Marca" valor="ACME"/>');
    const iPrecioTotal = xml.indexOf('<precioTotalSinImpuesto>');
    const iDetAdic = xml.indexOf('<detallesAdicionales>');
    const iImpuestos = xml.indexOf('<impuestos>');
    expect(iDetAdic).toBeGreaterThan(iPrecioTotal);
    expect(iImpuestos).toBeGreaterThan(iDetAdic);
  });

  it('emite pagos[].plazo/unidadTiempo después de total, con unidadTiempo por defecto "dias"', () => {
    const doc: LiquidacionCompra = {
      ...liquidacionCompraFixture,
      pagos: [{ ...liquidacionCompraFixture.pagos[0]!, plazo: '30' }],
    };
    const xml = new LiquidacionCompraXmlSerializer().serialize(doc, claveLiquidacionCompra);

    expect(xml).toContain('<plazo>30</plazo>');
    expect(xml).toContain('<unidadTiempo>dias</unidadTiempo>');
    const iTotal = xml.indexOf('<total>');
    const iPlazo = xml.indexOf('<plazo>');
    expect(iPlazo).toBeGreaterThan(iTotal);
  });

  it('respeta unidadTiempo explícito cuando se provee (no fuerza el default)', () => {
    const doc: LiquidacionCompra = {
      ...liquidacionCompraFixture,
      pagos: [{ ...liquidacionCompraFixture.pagos[0]!, plazo: '15', unidadTiempo: 'meses' }],
    };
    const xml = new LiquidacionCompraXmlSerializer().serialize(doc, claveLiquidacionCompra);

    expect(xml).toContain('<unidadTiempo>meses</unidadTiempo>');
    expect(xml).not.toContain('<unidadTiempo>dias</unidadTiempo>');
  });

  it('no emite plazo/unidadTiempo cuando plazo está ausente', () => {
    const xml = new LiquidacionCompraXmlSerializer().serialize(
      liquidacionCompraFixture,
      claveLiquidacionCompra,
    );

    expect(xml).not.toContain('<plazo>');
    expect(xml).not.toContain('<unidadTiempo>');
  });

  it('emite infoAdicional como último hijo de <liquidacionCompra>, después de detalles', () => {
    const xml = new LiquidacionCompraXmlSerializer().serialize(
      liquidacionCompraFixture,
      claveLiquidacionCompra,
    );

    expect(xml).toContain(
      '<campoAdicional nombre="Observacion">Compra a productor local</campoAdicional>',
    );
    const iCierreDetalles = xml.indexOf('</detalles>');
    const iInfoAdicional = xml.indexOf('<infoAdicional>');
    expect(iInfoAdicional).toBeGreaterThan(iCierreDetalles);
    expect(xml.endsWith('</infoAdicional></liquidacionCompra>')).toBe(true);
  });

  it('no serializa infoAdicional cuando está ausente', () => {
    const xml = new LiquidacionCompraXmlSerializer().serialize(
      liquidacionCompraGolden,
      claveLiquidacionCompra,
    );

    expect(xml).not.toContain('infoAdicional');
  });
});

describe('NotaCreditoXmlSerializer', () => {
  it('la clave de acceso calculada coincide con la usada por scripts/gen-fixtures.php', () => {
    expect(claveNotaCredito).toBe('0308202604179001100100110010010000000031234567817');
  });

  it('serializa notaCreditoGolden idéntico (normalizado) al fixture dorado generado por PHP', () => {
    const xml = new NotaCreditoXmlSerializer().serialize(notaCreditoGolden, claveNotaCredito);

    expect(normalizeXml(xml)).toBe(normalizeXml(goldenNotaCredito));
  });

  it('emite el elemento raíz <notaCredito id="comprobante" version="1.1.0">', () => {
    const xml = new NotaCreditoXmlSerializer().serialize(notaCreditoGolden, claveNotaCredito);

    expect(xml).toContain('<notaCredito id="comprobante" version="1.1.0">');
  });

  it('respeta el orden de elementos infoTributaria → infoNotaCredito → detalles', () => {
    const xml = new NotaCreditoXmlSerializer().serialize(notaCreditoGolden, claveNotaCredito);

    const iTributaria = xml.indexOf('<infoTributaria>');
    const iInfo = xml.indexOf('<infoNotaCredito>');
    const iDetalles = xml.indexOf('<detalles>');
    expect(iTributaria).toBeGreaterThan(-1);
    expect(iInfo).toBeGreaterThan(iTributaria);
    expect(iDetalles).toBeGreaterThan(iInfo);
  });

  it('remapea codigoPrincipal/codigoAuxiliar a codigoInterno/codigoAdicional en el detalle', () => {
    const doc: NotaCredito = {
      ...notaCreditoFixture,
      detalles: [{ ...notaCreditoFixture.detalles[0]!, codigoAuxiliar: 'AUX-1' }],
    };
    const xml = new NotaCreditoXmlSerializer().serialize(doc, claveNotaCredito);

    expect(xml).toContain('<codigoInterno>PROD001</codigoInterno>');
    expect(xml).toContain('<codigoAdicional>AUX-1</codigoAdicional>');
    expect(xml).not.toContain('<codigoPrincipal>');
    expect(xml).not.toContain('<codigoAuxiliar>');
  });

  it('es determinista', () => {
    const s = new NotaCreditoXmlSerializer();
    expect(s.serialize(notaCreditoFixture, claveNotaCredito)).toBe(
      s.serialize(notaCreditoFixture, claveNotaCredito),
    );
  });
});

describe('NotaCreditoXmlSerializer — campos opcionales no representables en PHP v2 (o no cubiertos por el fixture)', () => {
  it('emite infoTributaria/agenteRetencion e infoTributaria/contribuyenteRimpe, después de dirMatriz', () => {
    const doc: NotaCredito = {
      ...notaCreditoFixture,
      infoTributaria: {
        ...notaCreditoFixture.infoTributaria,
        agenteRetencion: '30',
        contribuyenteRimpe: 'CONTRIBUYENTE RÉGIMEN RIMPE',
      },
    };
    const xml = new NotaCreditoXmlSerializer().serialize(doc, claveNotaCredito);

    expect(xml).toContain('<agenteRetencion>30</agenteRetencion>');
    expect(xml).toContain('<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>');
  });

  it('emite totalConImpuestos[].descuentoAdicional entre codigoPorcentaje y baseImponible', () => {
    const doc: NotaCredito = {
      ...notaCreditoFixture,
      totalConImpuestos: [
        { ...notaCreditoFixture.totalConImpuestos[0]!, descuentoAdicional: '1.00' },
      ],
    };
    const xml = new NotaCreditoXmlSerializer().serialize(doc, claveNotaCredito);

    expect(xml).toContain('<descuentoAdicional>1.00</descuentoAdicional>');
    const iCodPorc = xml.indexOf('<codigoPorcentaje>');
    const iDesc = xml.indexOf('<descuentoAdicional>');
    const iBase = xml.indexOf('<baseImponible>');
    expect(iDesc).toBeGreaterThan(iCodPorc);
    expect(iBase).toBeGreaterThan(iDesc);
  });

  it('emite rise (representable en PHP v2, no cubierto por el fixture base) después de obligadoContabilidad', () => {
    const doc: NotaCredito = { ...notaCreditoFixture, rise: 'Contribuyente Régimen RISE' };
    const xml = new NotaCreditoXmlSerializer().serialize(doc, claveNotaCredito);

    expect(xml).toContain('<rise>Contribuyente Régimen RISE</rise>');
    const iObligado = xml.indexOf('<obligadoContabilidad>');
    const iRise = xml.indexOf('<rise>');
    const iCodDocMod = xml.indexOf('<codDocModificado>');
    expect(iRise).toBeGreaterThan(iObligado);
    expect(iCodDocMod).toBeGreaterThan(iRise);
  });

  it('NO emite detallesAdicionales aunque el documento lo traiga (omisión deliberada, sin evidencia de soporte XSD/1.x para notaCredito)', () => {
    const doc: NotaCredito = {
      ...notaCreditoFixture,
      detalles: [
        { ...notaCreditoFixture.detalles[0]!, detallesAdicionales: { Color: 'Rojo' } },
      ],
    };
    const xml = new NotaCreditoXmlSerializer().serialize(doc, claveNotaCredito);

    expect(xml).not.toContain('detallesAdicionales');
    expect(xml).not.toContain('detAdicional');
  });

  it('emite infoAdicional como último hijo de <notaCredito>, después de detalles', () => {
    const xml = new NotaCreditoXmlSerializer().serialize(notaCreditoFixture, claveNotaCredito);

    expect(xml).toContain('<campoAdicional nombre="Email">cliente@example.com</campoAdicional>');
    const iCierreDetalles = xml.indexOf('</detalles>');
    const iInfoAdicional = xml.indexOf('<infoAdicional>');
    expect(iInfoAdicional).toBeGreaterThan(iCierreDetalles);
    expect(xml.endsWith('</infoAdicional></notaCredito>')).toBe(true);
  });

  it('no serializa infoAdicional cuando está ausente', () => {
    const xml = new NotaCreditoXmlSerializer().serialize(notaCreditoGolden, claveNotaCredito);

    expect(xml).not.toContain('infoAdicional');
  });
});

describe('NotaDebitoXmlSerializer', () => {
  it('la clave de acceso calculada coincide con la usada por scripts/gen-fixtures.php', () => {
    expect(claveNotaDebito).toBe('0308202605179001100100110010010000000041234567819');
  });

  it('serializa notaDebitoGolden idéntico (normalizado) al fixture dorado generado por PHP', () => {
    const xml = new NotaDebitoXmlSerializer().serialize(notaDebitoGolden, claveNotaDebito);

    expect(normalizeXml(xml)).toBe(normalizeXml(goldenNotaDebito));
  });

  it('emite el elemento raíz <notaDebito id="comprobante" version="1.0.0">', () => {
    const xml = new NotaDebitoXmlSerializer().serialize(notaDebitoGolden, claveNotaDebito);

    expect(xml).toContain('<notaDebito id="comprobante" version="1.0.0">');
  });

  it('respeta el orden de elementos infoTributaria → infoNotaDebito → motivos', () => {
    const xml = new NotaDebitoXmlSerializer().serialize(notaDebitoGolden, claveNotaDebito);

    const iTributaria = xml.indexOf('<infoTributaria>');
    const iInfo = xml.indexOf('<infoNotaDebito>');
    const iMotivos = xml.indexOf('<motivos>');
    expect(iTributaria).toBeGreaterThan(-1);
    expect(iInfo).toBeGreaterThan(iTributaria);
    expect(iMotivos).toBeGreaterThan(iInfo);
  });

  it('es determinista', () => {
    const s = new NotaDebitoXmlSerializer();
    expect(s.serialize(notaDebitoFixture, claveNotaDebito)).toBe(
      s.serialize(notaDebitoFixture, claveNotaDebito),
    );
  });
});

describe('NotaDebitoXmlSerializer — campos opcionales no representables en PHP v2 (o no cubiertos por el fixture)', () => {
  it('emite infoTributaria/agenteRetencion e infoTributaria/contribuyenteRimpe, después de dirMatriz', () => {
    const doc: NotaDebito = {
      ...notaDebitoFixture,
      infoTributaria: {
        ...notaDebitoFixture.infoTributaria,
        agenteRetencion: '30',
        contribuyenteRimpe: 'CONTRIBUYENTE RÉGIMEN RIMPE',
      },
    };
    const xml = new NotaDebitoXmlSerializer().serialize(doc, claveNotaDebito);

    expect(xml).toContain('<agenteRetencion>30</agenteRetencion>');
    expect(xml).toContain('<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>');
  });

  it('emite impuestos[].descuentoAdicional entre codigoPorcentaje y baseImponible', () => {
    const doc: NotaDebito = {
      ...notaDebitoFixture,
      impuestos: [{ ...notaDebitoFixture.impuestos[0]!, descuentoAdicional: '3.00' }],
    };
    const xml = new NotaDebitoXmlSerializer().serialize(doc, claveNotaDebito);

    expect(xml).toContain('<descuentoAdicional>3.00</descuentoAdicional>');
    const iCodPorc = xml.indexOf('<codigoPorcentaje>');
    const iDesc = xml.indexOf('<descuentoAdicional>');
    const iBase = xml.indexOf('<baseImponible>');
    expect(iDesc).toBeGreaterThan(iCodPorc);
    expect(iBase).toBeGreaterThan(iDesc);
  });

  it('emite pagos[].plazo/unidadTiempo después de total, con unidadTiempo por defecto "dias"', () => {
    const doc: NotaDebito = {
      ...notaDebitoFixture,
      pagos: [{ ...notaDebitoFixture.pagos[0]!, plazo: '30' }],
    };
    const xml = new NotaDebitoXmlSerializer().serialize(doc, claveNotaDebito);

    expect(xml).toContain('<plazo>30</plazo>');
    expect(xml).toContain('<unidadTiempo>dias</unidadTiempo>');
  });

  it('omite los wrappers <impuestos>/<pagos> cuando los arreglos vienen vacíos', () => {
    const doc: NotaDebito = { ...notaDebitoFixture, impuestos: [], pagos: [] };
    const xml = new NotaDebitoXmlSerializer().serialize(doc, claveNotaDebito);

    expect(xml).not.toContain('<impuestos>');
    expect(xml).not.toContain('<pagos>');
  });

  it('emite infoAdicional como último hijo de <notaDebito>, después de motivos', () => {
    const xml = new NotaDebitoXmlSerializer().serialize(notaDebitoFixture, claveNotaDebito);

    expect(xml).toContain('<campoAdicional nombre="Email">cliente@example.com</campoAdicional>');
    const iCierreMotivos = xml.indexOf('</motivos>');
    const iInfoAdicional = xml.indexOf('<infoAdicional>');
    expect(iInfoAdicional).toBeGreaterThan(iCierreMotivos);
    expect(xml.endsWith('</infoAdicional></notaDebito>')).toBe(true);
  });

  it('no serializa infoAdicional cuando está ausente', () => {
    const xml = new NotaDebitoXmlSerializer().serialize(notaDebitoGolden, claveNotaDebito);

    expect(xml).not.toContain('infoAdicional');
  });
});

describe('GuiaRemisionXmlSerializer', () => {
  it('la clave de acceso calculada coincide con la usada por scripts/gen-fixtures.php', () => {
    expect(claveGuiaRemision).toBe('0308202606179001100100110010010000000051234567810');
  });

  it('serializa guiaRemisionGolden idéntico (normalizado) al fixture dorado generado por PHP', () => {
    const xml = new GuiaRemisionXmlSerializer().serialize(guiaRemisionGolden, claveGuiaRemision);

    expect(normalizeXml(xml)).toBe(normalizeXml(goldenGuiaRemision));
  });

  it('emite el elemento raíz <guiaRemision id="comprobante" version="1.1.0">', () => {
    const xml = new GuiaRemisionXmlSerializer().serialize(guiaRemisionGolden, claveGuiaRemision);

    expect(xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');
  });

  it('respeta el orden de elementos infoTributaria → infoGuiaRemision → destinatarios', () => {
    const xml = new GuiaRemisionXmlSerializer().serialize(guiaRemisionGolden, claveGuiaRemision);

    const iTributaria = xml.indexOf('<infoTributaria>');
    const iInfo = xml.indexOf('<infoGuiaRemision>');
    const iDest = xml.indexOf('<destinatarios>');
    expect(iTributaria).toBeGreaterThan(-1);
    expect(iInfo).toBeGreaterThan(iTributaria);
    expect(iDest).toBeGreaterThan(iInfo);
  });

  it('cantidad del detalle del destinatario se serializa tal cual (sin formatMonto)', () => {
    const doc: GuiaRemision = {
      ...guiaRemisionFixture,
      destinatarios: [
        { ...guiaRemisionFixture.destinatarios[0]!, detalles: [{ descripcion: 'x', cantidad: '5' }] },
      ],
    };
    const xml = new GuiaRemisionXmlSerializer().serialize(doc, claveGuiaRemision);

    // '5' se mantiene '5' (no se reformatea a '5.000000' como en Factura/LiquidacionCompra).
    expect(xml).toContain('<cantidad>5</cantidad>');
  });

  it('es determinista', () => {
    const s = new GuiaRemisionXmlSerializer();
    expect(s.serialize(guiaRemisionFixture, claveGuiaRemision)).toBe(
      s.serialize(guiaRemisionFixture, claveGuiaRemision),
    );
  });
});

describe('GuiaRemisionXmlSerializer — campos opcionales no representables en PHP v2 (o no cubiertos por el fixture)', () => {
  it('emite infoTributaria/agenteRetencion e infoTributaria/contribuyenteRimpe, después de dirMatriz', () => {
    const doc: GuiaRemision = {
      ...guiaRemisionFixture,
      infoTributaria: {
        ...guiaRemisionFixture.infoTributaria,
        agenteRetencion: '30',
        contribuyenteRimpe: 'CONTRIBUYENTE RÉGIMEN RIMPE',
      },
    };
    const xml = new GuiaRemisionXmlSerializer().serialize(doc, claveGuiaRemision);

    expect(xml).toContain('<agenteRetencion>30</agenteRetencion>');
    expect(xml).toContain('<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>');
  });

  it('emite rise (representable en PHP v2, no cubierto por el fixture base) entre rucTransportista y obligadoContabilidad', () => {
    const doc: GuiaRemision = { ...guiaRemisionFixture, rise: 'Contribuyente Régimen RISE' };
    const xml = new GuiaRemisionXmlSerializer().serialize(doc, claveGuiaRemision);

    expect(xml).toContain('<rise>Contribuyente Régimen RISE</rise>');
    const iRuc = xml.indexOf('<rucTransportista>');
    const iRise = xml.indexOf('<rise>');
    const iObligado = xml.indexOf('<obligadoContabilidad>');
    expect(iRise).toBeGreaterThan(iRuc);
    expect(iObligado).toBeGreaterThan(iRise);
  });

  it('no emite obligadoContabilidad cuando está ausente (sin default, a diferencia de Factura/LiquidacionCompra/NotaCredito/NotaDebito)', () => {
    const doc: GuiaRemision = { ...guiaRemisionFixture, obligadoContabilidad: undefined };
    const xml = new GuiaRemisionXmlSerializer().serialize(doc, claveGuiaRemision);

    expect(xml).not.toContain('obligadoContabilidad');
  });

  it('emite codigoAdicional y detallesAdicionales en el detalle del destinatario', () => {
    const doc: GuiaRemision = {
      ...guiaRemisionFixture,
      destinatarios: [
        {
          ...guiaRemisionFixture.destinatarios[0]!,
          detalles: [
            {
              ...guiaRemisionFixture.destinatarios[0]!.detalles[0]!,
              codigoAdicional: 'ADIC-1',
              detallesAdicionales: { Color: 'Azul', Talla: 'M' },
            },
          ],
        },
      ],
    };
    const xml = new GuiaRemisionXmlSerializer().serialize(doc, claveGuiaRemision);

    expect(xml).toContain('<codigoAdicional>ADIC-1</codigoAdicional>');
    expect(xml).toContain('<detAdicional nombre="Color" valor="Azul"/>');
    expect(xml).toContain('<detAdicional nombre="Talla" valor="M"/>');
  });

  it('emite infoAdicional como último hijo de <guiaRemision>, después de destinatarios', () => {
    const xml = new GuiaRemisionXmlSerializer().serialize(guiaRemisionFixture, claveGuiaRemision);

    expect(xml).toContain(
      '<campoAdicional nombre="Email">transporte@example.com</campoAdicional>',
    );
    const iCierreDest = xml.indexOf('</destinatarios>');
    const iInfoAdicional = xml.indexOf('<infoAdicional>');
    expect(iInfoAdicional).toBeGreaterThan(iCierreDest);
    expect(xml.endsWith('</infoAdicional></guiaRemision>')).toBe(true);
  });

  it('no serializa infoAdicional cuando está ausente', () => {
    const xml = new GuiaRemisionXmlSerializer().serialize(guiaRemisionGolden, claveGuiaRemision);

    expect(xml).not.toContain('infoAdicional');
  });
});

describe('RetencionXmlSerializer', () => {
  it('la clave de acceso calculada coincide con la usada por scripts/gen-fixtures.php', () => {
    expect(claveRetencion).toBe('0308202607179001100100110010010000000061234567812');
  });

  it('serializa retencionGolden idéntico (normalizado) al fixture dorado generado por PHP', () => {
    const xml = new RetencionXmlSerializer().serialize(retencionGolden, claveRetencion);

    expect(normalizeXml(xml)).toBe(normalizeXml(goldenRetencion));
  });

  it('emite el elemento raíz <comprobanteRetencion id="comprobante" version="2.0.0">', () => {
    const xml = new RetencionXmlSerializer().serialize(retencionGolden, claveRetencion);

    expect(xml).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
  });

  it('respeta el orden de elementos infoTributaria → infoCompRetencion → docsSustento', () => {
    const xml = new RetencionXmlSerializer().serialize(retencionGolden, claveRetencion);

    const iTributaria = xml.indexOf('<infoTributaria>');
    const iInfo = xml.indexOf('<infoCompRetencion>');
    const iDocs = xml.indexOf('<docsSustento>');
    expect(iTributaria).toBeGreaterThan(-1);
    expect(iInfo).toBeGreaterThan(iTributaria);
    expect(iDocs).toBeGreaterThan(iInfo);
  });

  it('es determinista', () => {
    const s = new RetencionXmlSerializer();
    expect(s.serialize(retencionFixture, claveRetencion)).toBe(
      s.serialize(retencionFixture, claveRetencion),
    );
  });
});

describe('RetencionXmlSerializer — campos opcionales no representables en PHP v2 (o no cubiertos por el fixture)', () => {
  it('emite infoTributaria/agenteRetencion e infoTributaria/contribuyenteRimpe, después de dirMatriz', () => {
    const doc: Retencion = {
      ...retencionFixture,
      infoTributaria: {
        ...retencionFixture.infoTributaria,
        agenteRetencion: '30',
        contribuyenteRimpe: 'CONTRIBUYENTE RÉGIMEN RIMPE',
      },
    };
    const xml = new RetencionXmlSerializer().serialize(doc, claveRetencion);

    expect(xml).toContain('<agenteRetencion>30</agenteRetencion>');
    expect(xml).toContain('<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>');
  });

  it('no emite obligadoContabilidad cuando está ausente (sin default, igual que GuiaRemision)', () => {
    const doc: Retencion = { ...retencionFixture, obligadoContabilidad: undefined };
    const xml = new RetencionXmlSerializer().serialize(doc, claveRetencion);

    expect(xml).not.toContain('obligadoContabilidad');
  });

  it('emite parteRel (representable en PHP v2, no cubierto por el fixture base) después de tipoSujetoRetenido', () => {
    const doc: Retencion = { ...retencionFixture, parteRel: 'SI' };
    const xml = new RetencionXmlSerializer().serialize(doc, claveRetencion);

    expect(xml).toContain('<parteRel>SI</parteRel>');
    const iTipoSujeto = xml.indexOf('<tipoSujetoRetenido>');
    const iParteRel = xml.indexOf('<parteRel>');
    const iRazonSocial = xml.indexOf('<razonSocialSujetoRetenido>');
    expect(iParteRel).toBeGreaterThan(iTipoSujeto);
    expect(iRazonSocial).toBeGreaterThan(iParteRel);
  });

  it('emite los 11 campos opcionales de docSustento, en el orden del XSD, entre fechaEmisionDocSustento y totalSinImpuestos', () => {
    const doc: Retencion = {
      ...retencionFixture,
      docsSustento: [
        {
          ...retencionFixture.docsSustento[0]!,
          fechaRegistroContable: '02/08/2026',
          numAutDocSustento: '1234567890',
          pagoLocExt: '01',
          tipoRegi: '01',
          paisEfecPago: 'EC',
          aplicConvDobTwordsri: 'NO',
          pagExtSujRetNorLeg: 'NO',
          pagoRegFis: 'NO',
          totalComprobantesReembolso: '0.00',
          totalBaseImponibleReembolso: '0.00',
          totalImpuestoReembolso: '0.00',
        },
      ],
    };
    const xml = new RetencionXmlSerializer().serialize(doc, claveRetencion);

    const camposEnOrden = [
      'fechaEmisionDocSustento',
      'fechaRegistroContable',
      'numAutDocSustento',
      'pagoLocExt',
      'tipoRegi',
      'paisEfecPago',
      'aplicConvDobTwordsri',
      'pagExtSujRetNorLeg',
      'pagoRegFis',
      'totalComprobantesReembolso',
      'totalBaseImponibleReembolso',
      'totalImpuestoReembolso',
      'totalSinImpuestos',
    ];
    const indices = camposEnOrden.map((el) => xml.indexOf(`<${el}>`));
    for (const i of indices) {
      expect(i).toBeGreaterThan(-1);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]!);
    }
  });

  it('coerciona valores "" a elemento vacío en las filas genéricas (impuestosDocSustento/retenciones/pagos), igual que RetencionXmlSerializer::docsSustento() en PHP', () => {
    const doc: Retencion = {
      ...retencionFixture,
      docsSustento: [
        {
          ...retencionFixture.docsSustento[0]!,
          retenciones: [{ ...retencionFixture.docsSustento[0]!.retenciones[0]!, codigoRetencion: '' }],
        },
      ],
    };
    const xml = new RetencionXmlSerializer().serialize(doc, claveRetencion);

    // Elemento vacío (sin nodo de texto): el serializador TS lo renderiza
    // autocerrado (`<el/>`), a diferencia del `<el></el>` de PHP/DOMDocument
    // — normalizado por `normalizeXml()` en el test golden, pero aquí es un
    // assert directo así que se compara con la forma real de `XmlBuilder`.
    expect(xml).toContain('<codigoRetencion/>');
    expect(xml).not.toContain('<codigoRetencion>');
  });

  it('serializa un campo SRI adicional no listado en el tipo (vía el índice [extra: string]) en cualquiera de las 3 filas genéricas', () => {
    const doc: Retencion = {
      ...retencionFixture,
      docsSustento: [
        {
          ...retencionFixture.docsSustento[0]!,
          pagos: [{ ...retencionFixture.docsSustento[0]!.pagos[0]!, numeroCuenta: '001-12345-6' }],
        },
      ],
    };
    const xml = new RetencionXmlSerializer().serialize(doc, claveRetencion);

    expect(xml).toContain('<numeroCuenta>001-12345-6</numeroCuenta>');
  });

  it('emite infoAdicional como último hijo de <comprobanteRetencion>, después de docsSustento', () => {
    const xml = new RetencionXmlSerializer().serialize(retencionFixture, claveRetencion);

    expect(xml).toContain(
      '<campoAdicional nombre="Email">contabilidad@example.com</campoAdicional>',
    );
    const iCierreDocs = xml.indexOf('</docsSustento>');
    const iInfoAdicional = xml.indexOf('<infoAdicional>');
    expect(iInfoAdicional).toBeGreaterThan(iCierreDocs);
    expect(xml.endsWith('</infoAdicional></comprobanteRetencion>')).toBe(true);
  });

  it('no serializa infoAdicional cuando está ausente', () => {
    const xml = new RetencionXmlSerializer().serialize(retencionGolden, claveRetencion);

    expect(xml).not.toContain('infoAdicional');
  });
});

describe('serializerFor — los 6 tipos de comprobante', () => {
  it('devuelve la instancia del serializador correcto para cada uno de los 6 tipos', () => {
    expect(serializerFor(TipoComprobante.Factura)).toBeInstanceOf(FacturaXmlSerializer);
    expect(serializerFor(TipoComprobante.LiquidacionCompra)).toBeInstanceOf(
      LiquidacionCompraXmlSerializer,
    );
    expect(serializerFor(TipoComprobante.NotaCredito)).toBeInstanceOf(NotaCreditoXmlSerializer);
    expect(serializerFor(TipoComprobante.NotaDebito)).toBeInstanceOf(NotaDebitoXmlSerializer);
    expect(serializerFor(TipoComprobante.GuiaRemision)).toBeInstanceOf(GuiaRemisionXmlSerializer);
    expect(serializerFor(TipoComprobante.Retencion)).toBeInstanceOf(RetencionXmlSerializer);
  });

  it('cada serializador registrado produce el elemento raíz XSD esperado', () => {
    expect(
      serializerFor(TipoComprobante.Factura).serialize(facturaFixture, claveNotaCredito),
    ).toContain('<factura id="comprobante" version="2.1.0">');
    expect(
      serializerFor(TipoComprobante.LiquidacionCompra).serialize(
        liquidacionCompraFixture,
        claveLiquidacionCompra,
      ),
    ).toContain('<liquidacionCompra id="comprobante" version="1.1.0">');
    expect(
      serializerFor(TipoComprobante.NotaCredito).serialize(notaCreditoFixture, claveNotaCredito),
    ).toContain('<notaCredito id="comprobante" version="1.1.0">');
    expect(
      serializerFor(TipoComprobante.NotaDebito).serialize(notaDebitoFixture, claveNotaDebito),
    ).toContain('<notaDebito id="comprobante" version="1.0.0">');
    expect(
      serializerFor(TipoComprobante.GuiaRemision).serialize(
        guiaRemisionFixture,
        claveGuiaRemision,
      ),
    ).toContain('<guiaRemision id="comprobante" version="1.1.0">');
    expect(
      serializerFor(TipoComprobante.Retencion).serialize(retencionFixture, claveRetencion),
    ).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
  });

  it('lanza ValidationError con mensaje claro para un código fuera del catálogo de 6 comprobantes', () => {
    const tipoInvalido = '99' as TipoComprobante;

    expect(() => serializerFor(tipoInvalido)).toThrow(ValidationError);
    expect(() => serializerFor(tipoInvalido)).toThrow(/99/);
  });
});
