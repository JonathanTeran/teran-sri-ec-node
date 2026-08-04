import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TipoComprobante } from '../src/catalogs/index.js';
import type { Factura } from '../src/documents/index.js';
import { generarClaveAcceso } from '../src/utils/clave-acceso.js';
import { ValidationError } from '../src/errors/index.js';
import { FacturaXmlSerializer } from '../src/xml/factura.serializer.js';
import { serializerFor } from '../src/xml/index.js';
import { escapeXml, XmlBuilder, XmlElement } from '../src/xml/xml-builder.js';
import { facturaFixture } from './documents.test.js';

/**
 * Fixture dorado generado por el paquete PHP real (`scripts/gen-fixtures.php`
 * en la raíz del repo, que corre `Teran\Sri\Xml\FacturaXmlSerializer` de
 * `teran-sri-ec` vía `vendor/autoload.php`). Regenerar con:
 *
 *   php scripts/gen-fixtures.php
 *
 * y commitear el XML resultante. Ver ese script para el detalle exacto de
 * qué subconjunto de `facturaFixture` es representable en la API v2 de PHP.
 */
const GOLDEN_PATH = fileURLToPath(new URL('./fixtures/factura.xml', import.meta.url));
const golden = readFileSync(GOLDEN_PATH, 'utf8');

/**
 * Misma clave de acceso, con los mismos parámetros, que
 * `scripts/gen-fixtures.php` le pasa a `Teran\Sri\Utils\ClaveAcceso::generar()`
 * — ambos algoritmos (Módulo 11) son idénticos campo a campo, así que ambos
 * lados producen el mismo string de 49 dígitos para los mismos parámetros.
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

/** Colapsa espacios en blanco entre etiquetas, para comparar XML sin pretty-print (TS) contra XML con pretty-print (PHP, `formatOutput = true`). */
function normalizeXml(xml: string): string {
  return xml.replace(/>\s+</g, '><').trim();
}

/**
 * `facturaFixture` sin los 2 campos que sí trae con valor (`direccionComprador`,
 * `infoAdicional`) de los 7 campos opcionales que este serializador puede
 * emitir cuando están presentes (ver doc de `FacturaXmlSerializer`) — el
 * subconjunto que SÍ es representable en el value object v2 de PHP
 * (`Documents\Factura`), o sea, exactamente lo que construye
 * `scripts/gen-fixtures.php` para generar `test/fixtures/factura.xml`.
 * `guiaRemision`, `TotalImpuesto.descuentoAdicional`,
 * `InfoTributaria.contribuyenteRimpe`/`agenteRetencion` ya vienen ausentes
 * en `facturaFixture`, así que no hace falta desactivarlos aquí.
 */
const facturaGolden: Factura = {
  ...facturaFixture,
  direccionComprador: undefined,
  infoAdicional: undefined,
};

describe('FacturaXmlSerializer', () => {
  it('la clave de acceso calculada coincide con la usada por scripts/gen-fixtures.php', () => {
    // Ancla de regresión: si alguien cambia los parámetros de arriba sin
    // regenerar el fixture PHP, este assert (previo al golden) falla con un
    // mensaje claro en vez de un diff XML gigante.
    expect(claveAcceso).toBe('0308202601179001100100110010010000000011234567817');
  });

  it('serializa facturaGolden (sin los campos no representables en PHP v2) idéntico (normalizado) al fixture dorado generado por PHP', () => {
    // Regresión pedida en la revisión: omitir los 7 campos opcionales
    // nuevos (usando facturaGolden, que solo desactiva los 2 que
    // facturaFixture trae con valor) debe seguir reproduciendo el XML
    // dorado byte a byte (normalizado). facturaFixture completo (con
    // direccionComprador/infoAdicional presentes) NO se compara aquí — ver
    // el describe 'campos opcionales del XSD 2.1.0' más abajo, que verifica
    // que sí se emiten cuando están presentes.
    const xml = new FacturaXmlSerializer().serialize(facturaGolden, claveAcceso);

    expect(normalizeXml(xml)).toBe(normalizeXml(golden));
  });

  it('respeta el orden de elementos infoTributaria → infoFactura → detalles', () => {
    const xml = new FacturaXmlSerializer().serialize(facturaGolden, claveAcceso);

    const iTributaria = xml.indexOf('<infoTributaria>');
    const iFactura = xml.indexOf('<infoFactura>');
    const iDetalles = xml.indexOf('<detalles>');

    expect(iTributaria).toBeGreaterThan(-1);
    expect(iFactura).toBeGreaterThan(iTributaria);
    expect(iDetalles).toBeGreaterThan(iFactura);
  });

  it('no serializa infoAdicional/direccionComprador cuando están ausentes', () => {
    const xml = new FacturaXmlSerializer().serialize(facturaGolden, claveAcceso);

    expect(xml).not.toContain('infoAdicional');
    expect(xml).not.toContain('direccionComprador');
  });

  it('incluye la claveAcceso recibida como parámetro', () => {
    const xml = new FacturaXmlSerializer().serialize(facturaFixture, claveAcceso);

    expect(xml).toContain(`<claveAcceso>${claveAcceso}</claveAcceso>`);
  });

  it('emite el elemento raíz <factura id="comprobante" version="2.1.0">', () => {
    const xml = new FacturaXmlSerializer().serialize(facturaFixture, claveAcceso);

    expect(xml).toContain('<factura id="comprobante" version="2.1.0">');
  });

  it('formatea cantidad/precioUnitario a 6 decimales y los montos a 2', () => {
    const xml = new FacturaXmlSerializer().serialize(facturaFixture, claveAcceso);

    expect(xml).toContain('<cantidad>1.000000</cantidad>');
    expect(xml).toContain('<precioUnitario>100.000000</precioUnitario>');
    expect(xml).toContain('<importeTotal>112.00</importeTotal>');
  });

  it('escapa & en razonSocial (assert directo, no golden)', () => {
    const conAmpersand: Factura = {
      ...facturaFixture,
      infoTributaria: { ...facturaFixture.infoTributaria, razonSocial: 'COMERCIAL J & M' },
    };

    const xml = new FacturaXmlSerializer().serialize(conAmpersand, claveAcceso);

    expect(xml).toContain('<razonSocial>COMERCIAL J &amp; M</razonSocial>');
    expect(xml).not.toContain('COMERCIAL J & M<');
  });

  it('es determinista: mismo documento + misma claveAcceso → mismo XML siempre', () => {
    const serializer = new FacturaXmlSerializer();

    const a = serializer.serialize(facturaFixture, claveAcceso);
    const b = serializer.serialize(facturaFixture, claveAcceso);

    expect(a).toBe(b);
  });

  it('tarifa vacía se formatea como "0.00" (port de test_tarifa_defaults_to_zero_formatted_when_absent)', () => {
    const sinTarifa: Factura = {
      ...facturaFixture,
      detalles: [
        {
          ...facturaFixture.detalles[0]!,
          impuestos: [{ ...facturaFixture.detalles[0]!.impuestos[0]!, tarifa: '' }],
        },
      ],
    };

    const xml = new FacturaXmlSerializer().serialize(sinTarifa, claveAcceso);

    expect(xml).toContain('<tarifa>0.00</tarifa>');
  });
});

/**
 * Factura con los 9 campos opcionales del XSD 2.1.0 que el value object v2
 * de PHP no modela, pero que sí son legales (`minOccurs="0"`) y que el
 * generador 1.x (`FacturaGenerator.php`/`XmlGenerator.php`) escribe cuando
 * están presentes. `direccionComprador` e `infoAdicional` ya vienen con
 * valor en `facturaFixture`; los otros 7 se agregan aquí explícitamente
 * (`detallesAdicionales`/`plazo`+`unidadTiempo` añadidos en la ronda de fix
 * del reviewer — ver `task-8-report.md`, sección "Fix round 1"). `moneda`/
 * `propina` se fuerzan a valores distintos del literal por defecto
 * (`'DOLAR'`/`'0.00'`) para verificar que el serializador los lee del
 * documento en vez de ignorarlos.
 */
const facturaConOpcionales: Factura = {
  ...facturaFixture,
  infoTributaria: {
    ...facturaFixture.infoTributaria,
    agenteRetencion: '30',
    contribuyenteRimpe: 'CONTRIBUYENTE RÉGIMEN RIMPE',
  },
  guiaRemision: '001-001-000000123',
  propina: '1.50',
  moneda: 'USD',
  totalConImpuestos: [{ ...facturaFixture.totalConImpuestos[0]!, descuentoAdicional: '5.00' }],
  detalles: [
    {
      ...facturaFixture.detalles[0]!,
      detallesAdicionales: { Color: 'Rojo', Talla: 'M' },
    },
  ],
  pagos: [{ ...facturaFixture.pagos[0]!, plazo: '30' }],
  infoAdicional: { Email: 'cliente@example.com', Telefono: '0999999999' },
};

describe('FacturaXmlSerializer — campos opcionales del XSD 2.1.0 (no modelados en PHP v2)', () => {
  const xml = new FacturaXmlSerializer().serialize(facturaConOpcionales, claveAcceso);

  it('emite infoTributaria/agenteRetencion e infoTributaria/contribuyenteRimpe con su valor', () => {
    expect(xml).toContain('<agenteRetencion>30</agenteRetencion>');
    expect(xml).toContain('<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>');
  });

  it('posiciona agenteRetencion/contribuyenteRimpe después de dirMatriz, en ese orden, dentro de infoTributaria', () => {
    const iDirMatriz = xml.indexOf('<dirMatriz>');
    const iAgenteRetencion = xml.indexOf('<agenteRetencion>');
    const iContribuyenteRimpe = xml.indexOf('<contribuyenteRimpe>');
    const iCierreInfoTributaria = xml.indexOf('</infoTributaria>');

    expect(iDirMatriz).toBeGreaterThan(-1);
    expect(iAgenteRetencion).toBeGreaterThan(iDirMatriz);
    expect(iContribuyenteRimpe).toBeGreaterThan(iAgenteRetencion);
    expect(iCierreInfoTributaria).toBeGreaterThan(iContribuyenteRimpe);
  });

  it('emite guiaRemision entre tipoIdentificacionComprador y razonSocialComprador', () => {
    expect(xml).toContain('<guiaRemision>001-001-000000123</guiaRemision>');

    const iTipoIdent = xml.indexOf('<tipoIdentificacionComprador>');
    const iGuiaRemision = xml.indexOf('<guiaRemision>');
    const iRazonSocialComprador = xml.indexOf('<razonSocialComprador>');

    expect(iGuiaRemision).toBeGreaterThan(iTipoIdent);
    expect(iRazonSocialComprador).toBeGreaterThan(iGuiaRemision);
  });

  it('emite direccionComprador entre identificacionComprador y totalSinImpuestos', () => {
    expect(xml).toContain('<direccionComprador>Calle Falsa 123, Quito</direccionComprador>');

    const iIdentComprador = xml.indexOf('<identificacionComprador>');
    const iDireccionComprador = xml.indexOf('<direccionComprador>');
    const iTotalSinImpuestos = xml.indexOf('<totalSinImpuestos>');

    expect(iDireccionComprador).toBeGreaterThan(iIdentComprador);
    expect(iTotalSinImpuestos).toBeGreaterThan(iDireccionComprador);
  });

  it('emite descuentoAdicional dentro de totalImpuesto, entre codigoPorcentaje y baseImponible', () => {
    expect(xml).toContain('<descuentoAdicional>5.00</descuentoAdicional>');

    const iCodigoPorcentaje = xml.indexOf('<codigoPorcentaje>');
    const iDescuentoAdicional = xml.indexOf('<descuentoAdicional>');
    const iBaseImponible = xml.indexOf('<baseImponible>');

    expect(iDescuentoAdicional).toBeGreaterThan(iCodigoPorcentaje);
    expect(iBaseImponible).toBeGreaterThan(iDescuentoAdicional);
  });

  it('lee propina/moneda del documento en vez del literal por defecto, cuando están presentes', () => {
    expect(xml).toContain('<propina>1.50</propina>');
    expect(xml).toContain('<moneda>USD</moneda>');
    expect(xml).not.toContain('<propina>0.00</propina>');
    expect(xml).not.toContain('<moneda>DOLAR</moneda>');
  });

  it('propina/moneda usan el literal por defecto cuando están ausentes', () => {
    const sinPropinaNiMoneda: Factura = { ...facturaFixture, propina: undefined, moneda: undefined };
    const xmlDefault = new FacturaXmlSerializer().serialize(sinPropinaNiMoneda, claveAcceso);

    expect(xmlDefault).toContain('<propina>0.00</propina>');
    expect(xmlDefault).toContain('<moneda>DOLAR</moneda>');
  });

  it('emite infoAdicional (con sus campoAdicional[nombre]) como último hijo de <factura>, después de detalles', () => {
    expect(xml).toContain('<campoAdicional nombre="Email">cliente@example.com</campoAdicional>');
    expect(xml).toContain('<campoAdicional nombre="Telefono">0999999999</campoAdicional>');

    // Orden de inserción del record `infoAdicional` (Email antes que Telefono).
    expect(xml.indexOf('nombre="Email"')).toBeLessThan(xml.indexOf('nombre="Telefono"'));

    const iCierreDetalles = xml.indexOf('</detalles>');
    const iInfoAdicional = xml.indexOf('<infoAdicional>');

    expect(iInfoAdicional).toBeGreaterThan(iCierreDetalles);
    expect(xml.endsWith('</infoAdicional></factura>')).toBe(true);
  });

  it('emite detalles[].detallesAdicionales entre precioTotalSinImpuesto e impuestos (fix round 1, hallazgo confirmado del reviewer)', () => {
    expect(xml).toContain('<detAdicional nombre="Color" valor="Rojo"/>');
    expect(xml).toContain('<detAdicional nombre="Talla" valor="M"/>');

    const iPrecioTotal = xml.indexOf('<precioTotalSinImpuesto>');
    const iDetAdic = xml.indexOf('<detallesAdicionales>');
    const iImpuestos = xml.indexOf('<impuestos>');

    expect(iDetAdic).toBeGreaterThan(iPrecioTotal);
    expect(iImpuestos).toBeGreaterThan(iDetAdic);
  });

  it('no emite detallesAdicionales cuando está ausente', () => {
    const xmlSinExtras = new FacturaXmlSerializer().serialize(facturaGolden, claveAcceso);

    expect(xmlSinExtras).not.toContain('detallesAdicionales');
  });

  it('emite pagos[].plazo después de total, con unidadTiempo por defecto "dias" (fix round 1, hallazgo confirmado del reviewer)', () => {
    expect(xml).toContain('<plazo>30</plazo>');
    expect(xml).toContain('<unidadTiempo>dias</unidadTiempo>');

    const iTotal = xml.indexOf('<total>');
    const iPlazo = xml.indexOf('<plazo>');
    const iUnidadTiempo = xml.indexOf('<unidadTiempo>');

    expect(iPlazo).toBeGreaterThan(iTotal);
    expect(iUnidadTiempo).toBeGreaterThan(iPlazo);
  });

  it('respeta unidadTiempo explícito cuando se provee (no fuerza el default "dias")', () => {
    const conUnidadExplicita: Factura = {
      ...facturaConOpcionales,
      pagos: [{ ...facturaConOpcionales.pagos[0]!, unidadTiempo: 'meses' }],
    };
    const xmlConUnidad = new FacturaXmlSerializer().serialize(conUnidadExplicita, claveAcceso);

    expect(xmlConUnidad).toContain('<unidadTiempo>meses</unidadTiempo>');
    expect(xmlConUnidad).not.toContain('<unidadTiempo>dias</unidadTiempo>');
  });

  it('no emite plazo/unidadTiempo cuando plazo está ausente', () => {
    const xmlSinExtras = new FacturaXmlSerializer().serialize(facturaGolden, claveAcceso);

    expect(xmlSinExtras).not.toContain('<plazo>');
    expect(xmlSinExtras).not.toContain('<unidadTiempo>');
  });
});

describe('serializerFor', () => {
  it('devuelve el FacturaXmlSerializer registrado para TipoComprobante.Factura', () => {
    const serializer = serializerFor(TipoComprobante.Factura);
    const xml = serializer.serialize(facturaFixture, claveAcceso);

    expect(xml).toContain('<factura id="comprobante" version="2.1.0">');
  });

  // El resto de los 6 tipos (LiquidacionCompra, NotaCredito, NotaDebito,
  // GuiaRemision, Retencion) se registran en Task 8 — ver
  // `describe('serializerFor — los 6 tipos de comprobante')` en
  // `test/xml-otros.test.ts`, que también cubre el caso de un `TipoComprobante`
  // fuera del enum (`ValidationError`).
});

describe('xml-builder', () => {
  describe('escapeXml', () => {
    it('escapa & < > " \'', () => {
      expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
    });

    it('no toca texto sin caracteres especiales', () => {
      expect(escapeXml('Tornillos y tuercas')).toBe('Tornillos y tuercas');
    });
  });

  describe('XmlBuilder.child', () => {
    it('lanza ValidationError con cadena vacía explícita', () => {
      const b = new XmlBuilder();
      const root = new XmlElement('root');

      expect(() => b.child(root, 'vacio', '')).toThrow(ValidationError);
    });

    it('crea un elemento vacío (sin nodo de texto) cuando value es null/omitido', () => {
      const b = new XmlBuilder();
      const root = new XmlElement('root');

      const contenedor = b.child(root, 'contenedor');

      expect(contenedor.children).toHaveLength(0);
      expect(root.children).toContain(contenedor);
    });
  });
});
