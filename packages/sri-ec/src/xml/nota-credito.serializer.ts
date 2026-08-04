import { TipoComprobante } from '../catalogs/index.js';
import type { NotaCredito } from '../documents/nota-credito.js';
import { formatMonto } from '../utils/money.js';
import { writeInfoAdicional, writeInfoTributaria } from './common.js';
import { XmlBuilder, XmlElement, serializeXmlDocument } from './xml-builder.js';

/**
 * Serializador XML de `NotaCredito` (codDoc `04`). Port campo a campo de
 * `src/Xml/NotaCreditoXmlSerializer.php`.
 *
 * Campos opcionales que el value object v2 de PHP (`Documents\NotaCredito`)
 * NO modela, pero que este serializador SÍ emite cuando el documento TS los
 * trae (mismo criterio que `LiquidacionCompraXmlSerializer`/
 * `FacturaXmlSerializer`, Task 7/8):
 *
 *   - `totalConImpuestos[].descuentoAdicional`: no existe en
 *     `Documents\Impuesto` (PHP) y `NotaCreditoXmlSerializer::infoNotaCredito()`
 *     nunca lo escribe, pero es el mismo complexType `totalImpuesto` que en
 *     `factura_v2.1.0.xsd`/`liquidacionCompra_v1.1.0.xsd`
 *     (`descuentoAdicional` `minOccurs="0"` entre `codigoPorcentaje` y
 *     `baseImponible`) — se asume la misma posición por convención de
 *     esquema SRI compartida entre comprobantes.
 *   - `infoAdicional` (top-level, último hijo de `<notaCredito>`): no existe
 *     en `Documents\NotaCredito`, pero sí en `NotaCreditoGenerator::generate()`
 *     (paso 4, 1.x) — ver `writeInfoAdicional()` en `common.ts`.
 *
 * `detalles[].detallesAdicionales` (campo del tipo compartido `Detalle`) NO
 * se emite aquí a propósito: a diferencia de `LiquidacionCompraGenerator`
 * (que sí lo soporta y cuyo XSD lo confirma), `NotaCreditoGenerator::createDetalles()`
 * (1.x) no lo contempla en absoluto — no hay evidencia de que el XSD 1.1.0
 * de notaCredito lo admita, así que se omite en vez de asumir una posición
 * sin respaldo.
 *
 * `codigoPrincipal`/`codigoAuxiliar` de `Detalle` se renombran en el XML a
 * `codigoInterno`/`codigoAdicional` (mismo remapeo que
 * `NotaCreditoXmlSerializer::detalles()`); no tiene `pagos` (el XSD 1.1.0 de
 * notaCredito no lo contempla, igual que el value object PHP).
 */
export class NotaCreditoXmlSerializer {
  private static readonly VERSION = '1.1.0';
  private static readonly COD_DOC = TipoComprobante.NotaCredito;
  private static readonly SCALE_MONEY = 2;
  private static readonly SCALE_QUANTITY = 6;

  serialize(doc: NotaCredito, claveAcceso: string): string {
    const b = new XmlBuilder();
    const root = new XmlElement('notaCredito');
    root.setAttribute('id', 'comprobante');
    root.setAttribute('version', NotaCreditoXmlSerializer.VERSION);

    writeInfoTributaria(b, root, doc.infoTributaria, claveAcceso, NotaCreditoXmlSerializer.COD_DOC);
    this.infoNotaCredito(b, root, doc);
    this.detalles(b, root, doc);
    writeInfoAdicional(b, root, doc.infoAdicional);

    return serializeXmlDocument(root);
  }

  private infoNotaCredito(b: XmlBuilder, root: XmlElement, doc: NotaCredito): void {
    const { SCALE_MONEY } = NotaCreditoXmlSerializer;
    const node = b.child(root, 'infoNotaCredito');
    b.child(node, 'fechaEmision', doc.fechaEmision);
    if (doc.dirEstablecimiento !== undefined) {
      b.child(node, 'dirEstablecimiento', doc.dirEstablecimiento);
    }
    b.child(node, 'tipoIdentificacionComprador', doc.tipoIdentificacionComprador);
    b.child(node, 'razonSocialComprador', doc.razonSocialComprador);
    b.child(node, 'identificacionComprador', doc.identificacionComprador);
    if (doc.contribuyenteEspecial !== undefined) {
      b.child(node, 'contribuyenteEspecial', doc.contribuyenteEspecial);
    }
    // Igual que `Documents\NotaCredito` (constructor con default 'NO'):
    // siempre se emite, con default cuando el documento no lo trae.
    b.child(node, 'obligadoContabilidad', doc.obligadoContabilidad ?? 'NO');
    if (doc.rise !== undefined) {
      b.child(node, 'rise', doc.rise);
    }
    b.child(node, 'codDocModificado', doc.codDocModificado);
    b.child(node, 'numDocModificado', doc.numDocModificado);
    b.child(node, 'fechaEmisionDocSustento', doc.fechaEmisionDocSustento);
    b.child(node, 'totalSinImpuestos', formatMonto(doc.totalSinImpuestos, SCALE_MONEY));
    b.child(node, 'valorModificacion', formatMonto(doc.valorModificacion, SCALE_MONEY));
    b.child(node, 'moneda', doc.moneda ?? 'DOLAR');

    const tci = b.child(node, 'totalConImpuestos');
    for (const imp of doc.totalConImpuestos) {
      const ti = b.child(tci, 'totalImpuesto');
      b.child(ti, 'codigo', imp.codigo);
      b.child(ti, 'codigoPorcentaje', imp.codigoPorcentaje);
      if (imp.descuentoAdicional !== undefined) {
        b.child(ti, 'descuentoAdicional', formatMonto(imp.descuentoAdicional, SCALE_MONEY));
      }
      b.child(ti, 'baseImponible', formatMonto(imp.baseImponible, SCALE_MONEY));
      b.child(ti, 'valor', formatMonto(imp.valor, SCALE_MONEY));
    }

    b.child(node, 'motivo', doc.motivo);
  }

  private detalles(b: XmlBuilder, root: XmlElement, doc: NotaCredito): void {
    const { SCALE_MONEY, SCALE_QUANTITY } = NotaCreditoXmlSerializer;
    const node = b.child(root, 'detalles');
    for (const det of doc.detalles) {
      const d = b.child(node, 'detalle');
      // Remapeo XML (1.x NC generator / NotaCreditoXmlSerializer::detalles()):
      // codigoPrincipal → codigoInterno, codigoAuxiliar → codigoAdicional.
      b.child(d, 'codigoInterno', det.codigoPrincipal ?? '');
      if (det.codigoAuxiliar !== undefined) {
        b.child(d, 'codigoAdicional', det.codigoAuxiliar);
      }
      b.child(d, 'descripcion', det.descripcion);
      b.child(d, 'cantidad', formatMonto(det.cantidad, SCALE_QUANTITY));
      b.child(d, 'precioUnitario', formatMonto(det.precioUnitario, SCALE_QUANTITY));
      b.child(d, 'descuento', formatMonto(det.descuento, SCALE_MONEY));
      b.child(d, 'precioTotalSinImpuesto', formatMonto(det.precioTotalSinImpuesto, SCALE_MONEY));

      const imps = b.child(d, 'impuestos');
      for (const imp of det.impuestos) {
        const i = b.child(imps, 'impuesto');
        b.child(i, 'codigo', imp.codigo);
        b.child(i, 'codigoPorcentaje', imp.codigoPorcentaje);
        // A diferencia de Factura/LiquidacionCompra, `NotaCreditoXmlSerializer::detalles()`
        // (PHP) NO escribe `tarifa` en el `impuesto` de detalle — solo
        // codigo, codigoPorcentaje, baseImponible, valor. Se replica tal
        // cual (no es un campo opcional omitido por error: la fuente de
        // verdad PHP confirma que no forma parte de este nodo para
        // notaCredito).
        b.child(i, 'baseImponible', formatMonto(imp.baseImponible, SCALE_MONEY));
        b.child(i, 'valor', formatMonto(imp.valor, SCALE_MONEY));
      }
    }
  }
}
