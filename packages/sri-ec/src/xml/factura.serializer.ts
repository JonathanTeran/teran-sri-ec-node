import { TipoComprobante, TipoEmision } from '../catalogs/index.js';
import type { Factura } from '../documents/factura.js';
import { formatMonto } from '../utils/money.js';
import { XmlBuilder, XmlElement, serializeXmlDocument } from './xml-builder.js';

/**
 * Serializador XML de `Factura` (codDoc `01`). Port campo a campo de
 * `src/Xml/FacturaXmlSerializer.php` — misma estructura, mismo orden base de
 * elementos (`infoTributaria` → `infoFactura` → `detalles`), mismos valores
 * literales (`codDoc`, `version`).
 *
 * `Documents\Factura` (value object v2 de PHP) y su serializador NO modelan
 * `dirEstablecimiento`, `contribuyenteEspecial`, `direccionComprador`,
 * `guiaRemision`, `infoAdicional`, `contribuyenteRimpe`, `agenteRetencion`,
 * `TotalImpuesto.descuentoAdicional`, `Detalle.detallesAdicionales` ni
 * `Pago.plazo`/`unidadTiempo` — pero SÍ son campos legales del XSD oficial
 * `factura_v2.1.0.xsd` (todos `minOccurs="0"`), y el generador 1.x
 * (`Generators/FacturaGenerator.php` + `Generators/XmlGenerator.php`) sí los
 * escribe cuando están presentes, en la posición exacta que exige la
 * secuencia del XSD. Este serializador emite esos 11 campos cuando el
 * documento TS los trae (el tipo `Factura` los modela todos como
 * opcionales), en la posición verificada directamente contra
 * `resources/xsd/factura_v2.1.0.xsd` (no solo contra el generador 1.x, que
 * apunta a la versión de esquema `1.1.0` — se usó como referencia de orden,
 * pero la fuente de verdad final es el XSD 2.1.0):
 *
 *   - `infoTributaria`: `dirMatriz` → `agenteRetencion`? → `contribuyenteRimpe`?
 *   - `infoFactura`: `fechaEmision` → `dirEstablecimiento`? →
 *     `contribuyenteEspecial`? → `obligadoContabilidad`? (`dirEstablecimiento`/
 *     `contribuyenteEspecial` son fix round 1, hallazgo confirmado del
 *     reviewer — gap real, no del RIDE: `Factura` era el único de los 6
 *     tipos de este port que no los modelaba) → `tipoIdentificacionComprador`
 *     → `guiaRemision`? → `razonSocialComprador` → `identificacionComprador`
 *     → `direccionComprador`? → `totalSinImpuestos`
 *   - `totalImpuesto`: `codigoPorcentaje` → `descuentoAdicional`? →
 *     `baseImponible`
 *   - `detalle`: `precioTotalSinImpuesto` → `detallesAdicionales`?
 *     (`detAdicional[nombre][valor]`, sin nodo de texto) → `impuestos`
 *     (XSD línea ~103; mismo mecanismo que `GuiaRemisionXmlSerializer`/
 *     `LiquidacionCompraXmlSerializer` de Task 8).
 *   - `pago`: `total` → `plazo`? → `unidadTiempo` (con `'dias'` por defecto
 *     si `plazo` está presente pero `unidadTiempo` no — XSD líneas
 *     ~154-159; mismo default que `LiquidacionCompraXmlSerializer`/
 *     `NotaDebitoXmlSerializer` de Task 8).
 *   - `infoAdicional` (con sus `campoAdicional[nombre]`) como último hijo de
 *     `<factura>`, después de `<detalles>`.
 *
 * `propina` y `moneda` sí son obligatorios en el XSD (siempre se emiten),
 * pero ya no se hardcodean: se lee `f.propina`/`f.moneda` si el documento
 * los trae, y solo se usa el literal (`'0.00'`/`'DOLAR'`) cuando están
 * ausentes — igual que `FacturaGenerator::createInfoFactura()`
 * (`$data['propina'] ?? 0`, `$data['moneda'] ?? 'DOLAR'`).
 */
export class FacturaXmlSerializer {
  private static readonly VERSION = '2.1.0';
  private static readonly COD_DOC = TipoComprobante.Factura;
  private static readonly SCALE_MONEY = 2;
  private static readonly SCALE_QUANTITY = 6;

  serialize(factura: Factura, claveAcceso: string): string {
    const b = new XmlBuilder();
    const root = new XmlElement('factura');
    root.setAttribute('id', 'comprobante');
    root.setAttribute('version', FacturaXmlSerializer.VERSION);

    this.infoTributaria(b, root, factura, claveAcceso);
    this.infoFactura(b, root, factura);
    this.detalles(b, root, factura);
    this.infoAdicional(b, root, factura);

    return serializeXmlDocument(root);
  }

  private infoTributaria(
    b: XmlBuilder,
    root: XmlElement,
    f: Factura,
    claveAcceso: string,
  ): void {
    const info = f.infoTributaria;
    const node = b.child(root, 'infoTributaria');
    b.child(node, 'ambiente', info.ambiente);
    // El value object v2 de PHP defaultea tipoEmision a Normal ('1') en su
    // constructor y siempre lo escribe; en TS el campo es opcional, así que
    // replicamos el mismo default aquí.
    b.child(node, 'tipoEmision', info.tipoEmision ?? TipoEmision.Normal);
    b.child(node, 'razonSocial', info.razonSocial);
    if (info.nombreComercial !== undefined) {
      b.child(node, 'nombreComercial', info.nombreComercial);
    }
    b.child(node, 'ruc', info.ruc);
    b.child(node, 'claveAcceso', claveAcceso);
    b.child(node, 'codDoc', FacturaXmlSerializer.COD_DOC);
    b.child(node, 'estab', info.estab);
    b.child(node, 'ptoEmi', info.ptoEmi);
    b.child(node, 'secuencial', info.secuencial);
    b.child(node, 'dirMatriz', info.dirMatriz);
    // Orden XSD (factura_v2.1.0.xsd, complexType infoTributaria): dirMatriz
    // → agenteRetencion? → contribuyenteRimpe?.
    if (info.agenteRetencion !== undefined) {
      b.child(node, 'agenteRetencion', info.agenteRetencion);
    }
    if (info.contribuyenteRimpe !== undefined) {
      b.child(node, 'contribuyenteRimpe', info.contribuyenteRimpe);
    }
  }

  private infoFactura(b: XmlBuilder, root: XmlElement, f: Factura): void {
    const { SCALE_MONEY } = FacturaXmlSerializer;
    const node = b.child(root, 'infoFactura');
    b.child(node, 'fechaEmision', f.fechaEmision);
    // Orden XSD (factura_v2.1.0.xsd, complexType infoFactura): fechaEmision →
    // dirEstablecimiento? → contribuyenteEspecial? → obligadoContabilidad?
    // (fix round 1, hallazgo confirmado del reviewer — mismo orden que
    // `FacturaGenerator::createInfoFactura()` 1.x, `$simpleFields`).
    if (f.dirEstablecimiento !== undefined) {
      b.child(node, 'dirEstablecimiento', f.dirEstablecimiento);
    }
    if (f.contribuyenteEspecial !== undefined) {
      b.child(node, 'contribuyenteEspecial', f.contribuyenteEspecial);
    }
    // El constructor v2 de PHP defaultea obligadoContabilidad a 'NO'.
    b.child(node, 'obligadoContabilidad', f.obligadoContabilidad ?? 'NO');
    b.child(node, 'tipoIdentificacionComprador', f.tipoIdentificacionComprador);
    // Orden XSD: tipoIdentificacionComprador → guiaRemision? → razonSocialComprador.
    if (f.guiaRemision !== undefined) {
      b.child(node, 'guiaRemision', f.guiaRemision);
    }
    b.child(node, 'razonSocialComprador', f.razonSocialComprador);
    b.child(node, 'identificacionComprador', f.identificacionComprador);
    // Orden XSD: identificacionComprador → direccionComprador? → totalSinImpuestos.
    if (f.direccionComprador !== undefined) {
      b.child(node, 'direccionComprador', f.direccionComprador);
    }
    b.child(node, 'totalSinImpuestos', formatMonto(f.totalSinImpuestos, SCALE_MONEY));
    b.child(node, 'totalDescuento', formatMonto(f.totalDescuento, SCALE_MONEY));

    const tci = b.child(node, 'totalConImpuestos');
    for (const imp of f.totalConImpuestos) {
      const ti = b.child(tci, 'totalImpuesto');
      b.child(ti, 'codigo', imp.codigo);
      b.child(ti, 'codigoPorcentaje', imp.codigoPorcentaje);
      // Orden XSD (complexType totalImpuesto): codigoPorcentaje →
      // descuentoAdicional? → baseImponible.
      if (imp.descuentoAdicional !== undefined) {
        b.child(ti, 'descuentoAdicional', formatMonto(imp.descuentoAdicional, SCALE_MONEY));
      }
      b.child(ti, 'baseImponible', formatMonto(imp.baseImponible, SCALE_MONEY));
      b.child(ti, 'valor', formatMonto(imp.valor, SCALE_MONEY));
    }

    // `propina`/`moneda` son obligatorios en el XSD (siempre se emiten),
    // pero su valor se lee del documento si está presente — solo se usa el
    // literal por defecto cuando el campo viene ausente, igual que
    // `FacturaGenerator::createInfoFactura()` (`$data['propina'] ?? 0`,
    // `$data['moneda'] ?? 'DOLAR'`).
    b.child(node, 'propina', formatMonto(f.propina ?? '0.00', SCALE_MONEY));
    b.child(node, 'importeTotal', formatMonto(f.importeTotal, SCALE_MONEY));
    b.child(node, 'moneda', f.moneda ?? 'DOLAR');

    const pagos = b.child(node, 'pagos');
    for (const pago of f.pagos) {
      const p = b.child(pagos, 'pago');
      b.child(p, 'formaPago', pago.formaPago);
      b.child(p, 'total', formatMonto(pago.total, SCALE_MONEY));
      // Orden XSD (complexType pago, factura_v2.1.0.xsd líneas ~154-159):
      // total → plazo? → unidadTiempo?. Port de
      // `LiquidacionCompraXmlSerializer::infoLiquidacionCompra()`
      // (`if ($pago->plazo !== null) { plazo; unidadTiempo ?? 'dias'; }`).
      if (pago.plazo !== undefined) {
        b.child(p, 'plazo', pago.plazo);
        b.child(p, 'unidadTiempo', pago.unidadTiempo ?? 'dias');
      }
    }
  }

  private detalles(b: XmlBuilder, root: XmlElement, f: Factura): void {
    const { SCALE_MONEY, SCALE_QUANTITY } = FacturaXmlSerializer;
    const node = b.child(root, 'detalles');
    for (const det of f.detalles) {
      const d = b.child(node, 'detalle');
      // `codigoPrincipal` es obligatorio y no vacío en el XSD y en
      // `Documents\Detalle` de PHP (que lanza si viene ''); el tipo TS lo
      // modela opcional, así que ausencia se trata como '' y XmlBuilder la
      // rechaza con el mismo error que un valor vacío explícito.
      b.child(d, 'codigoPrincipal', det.codigoPrincipal ?? '');
      if (det.codigoAuxiliar !== undefined) {
        b.child(d, 'codigoAuxiliar', det.codigoAuxiliar);
      }
      b.child(d, 'descripcion', det.descripcion);
      b.child(d, 'cantidad', formatMonto(det.cantidad, SCALE_QUANTITY));
      b.child(d, 'precioUnitario', formatMonto(det.precioUnitario, SCALE_QUANTITY));
      b.child(d, 'descuento', formatMonto(det.descuento, SCALE_MONEY));
      b.child(
        d,
        'precioTotalSinImpuesto',
        formatMonto(det.precioTotalSinImpuesto, SCALE_MONEY),
      );

      // Orden XSD (detalle, factura_v2.1.0.xsd línea ~103):
      // precioTotalSinImpuesto → detallesAdicionales? → impuestos. No
      // existe en `Documents\Detalle` de PHP, pero el tipo TS lo modela
      // (`Detalle.detallesAdicionales`, compartido con
      // LiquidacionCompra/NotaCredito) — mismo mecanismo `detAdicional
      // nombre/valor` que `LiquidacionCompraXmlSerializer`/
      // `GuiaRemisionXmlSerializer` de Task 8.
      const daEntries = det.detallesAdicionales ? Object.entries(det.detallesAdicionales) : [];
      if (daEntries.length > 0) {
        const da = b.child(d, 'detallesAdicionales');
        for (const [nombre, valor] of daEntries) {
          const item = b.child(da, 'detAdicional');
          item.setAttribute('nombre', nombre);
          item.setAttribute('valor', valor);
        }
      }

      const imps = b.child(d, 'impuestos');
      for (const imp of det.impuestos) {
        const i = b.child(imps, 'impuesto');
        b.child(i, 'codigo', imp.codigo);
        b.child(i, 'codigoPorcentaje', imp.codigoPorcentaje);
        // Port de `$tarifaStr = ($imp->tarifa === null || $imp->tarifa === '') ? '0' : $imp->tarifa;`
        const tarifaStr = imp.tarifa === '' ? '0' : imp.tarifa;
        b.child(i, 'tarifa', formatMonto(tarifaStr, SCALE_MONEY));
        b.child(i, 'baseImponible', formatMonto(imp.baseImponible, SCALE_MONEY));
        b.child(i, 'valor', formatMonto(imp.valor, SCALE_MONEY));
      }
    }
  }

  /**
   * `<infoAdicional>` — último hijo de `<factura>`, después de `<detalles>`
   * (port de `XmlGenerator::addInfoAdicional()` / `FacturaGenerator::generate()`,
   * paso 4). No existe en el value object v2 de PHP, pero sí en el XSD
   * oficial y en el generador 1.x; se omite el elemento por completo si
   * `infoAdicional` está ausente o vacío (mismo criterio que
   * `if (empty($infoAdicional)) return;`).
   */
  private infoAdicional(b: XmlBuilder, root: XmlElement, f: Factura): void {
    const entries = f.infoAdicional ? Object.entries(f.infoAdicional) : [];
    if (entries.length === 0) {
      return;
    }

    const node = b.child(root, 'infoAdicional');
    for (const [nombre, valor] of entries) {
      const campo = b.child(node, 'campoAdicional', valor);
      campo.setAttribute('nombre', nombre);
    }
  }
}
