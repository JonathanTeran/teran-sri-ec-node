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

describe('FacturaXmlSerializer', () => {
  it('la clave de acceso calculada coincide con la usada por scripts/gen-fixtures.php', () => {
    // Ancla de regresión: si alguien cambia los parámetros de arriba sin
    // regenerar el fixture PHP, este assert (previo al golden) falla con un
    // mensaje claro en vez de un diff XML gigante.
    expect(claveAcceso).toBe('0308202601179001100100110010010000000011234567817');
  });

  it('serializa facturaFixture idéntico (normalizado) al fixture dorado generado por PHP', () => {
    const xml = new FacturaXmlSerializer().serialize(facturaFixture, claveAcceso);

    expect(normalizeXml(xml)).toBe(normalizeXml(golden));
  });

  it('respeta el orden de elementos infoTributaria → infoFactura → detalles', () => {
    const xml = new FacturaXmlSerializer().serialize(facturaFixture, claveAcceso);

    const iTributaria = xml.indexOf('<infoTributaria>');
    const iFactura = xml.indexOf('<infoFactura>');
    const iDetalles = xml.indexOf('<detalles>');

    expect(iTributaria).toBeGreaterThan(-1);
    expect(iFactura).toBeGreaterThan(iTributaria);
    expect(iDetalles).toBeGreaterThan(iFactura);
  });

  it('no serializa infoAdicional (no representable en el value object v2 de PHP)', () => {
    // facturaFixture SÍ trae infoAdicional (Task 4 lo modela como campo
    // opcional para no perder cobertura de tipos), pero
    // FacturaXmlSerializer.php no tiene ningún método que lo escriba — se
    // mantiene la paridad ignorándolo también aquí.
    const xml = new FacturaXmlSerializer().serialize(facturaFixture, claveAcceso);

    expect(xml).not.toContain('infoAdicional');
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

describe('serializerFor', () => {
  it('devuelve el FacturaXmlSerializer registrado para TipoComprobante.Factura', () => {
    const serializer = serializerFor(TipoComprobante.Factura);
    const xml = serializer.serialize(facturaFixture, claveAcceso);

    expect(xml).toContain('<factura id="comprobante" version="2.1.0">');
  });

  it('lanza ValidationError con mensaje claro para un tipo aún no registrado (Task 8)', () => {
    expect(() => serializerFor(TipoComprobante.NotaCredito)).toThrow(ValidationError);
    expect(() => serializerFor(TipoComprobante.NotaCredito)).toThrow(/NotaCredito|04/);
  });
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
