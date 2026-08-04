import { TipoComprobante } from '../catalogs/index.js';
import type { NotaDebito } from '../documents/nota-debito.js';
import { formatMonto } from '../utils/money.js';
import { writeInfoAdicional, writeInfoTributaria } from './common.js';
import { XmlBuilder, XmlElement, serializeXmlDocument } from './xml-builder.js';

/**
 * Serializador XML de `NotaDebito` (codDoc `05`). Port campo a campo de
 * `src/Xml/NotaDebitoXmlSerializer.php` — misma estructura, mismo orden base
 * de elementos (`infoTributaria` → `infoNotaDebito` → `motivos`).
 *
 * `impuestos`/`pagos` de `infoNotaDebito` se envuelven condicionalmente
 * (`if (doc.impuestos.length > 0)` / `if (doc.pagos.length > 0)`), igual que
 * `NotaDebitoXmlSerializer::infoNotaDebito()` (`if ($doc->impuestos !== [])` /
 * `if ($doc->pagos !== [])`) — a diferencia de `LiquidacionCompraXmlSerializer`,
 * que siempre envuelve `pagos` incondicionalmente.
 *
 * Campos opcionales que el value object v2 de PHP (`Documents\Impuesto`,
 * `Documents\Pago`) no modela para este comprobante, pero que este
 * serializador SÍ emite cuando el documento TS los trae, por analogía con el
 * mismo complexType compartido (`totalImpuesto`/`pago`) confirmado en
 * `factura_v2.1.0.xsd`/`liquidacionCompra_v1.1.0.xsd` (no hay XSD 1.0.0 de
 * notaDebito en el repo PHP para confirmarlo directamente, pero el
 * generador 1.x (`NotaDebitoGenerator::createInfoNotaDebito()`) hace un
 * `foreach ($imp/$pago as $k => $v)` genérico que SÍ pasaría estas claves si
 * estuvieran presentes en el array crudo — no hay evidencia en contra):
 *
 *   - `impuestos[].descuentoAdicional`: entre `codigoPorcentaje` y
 *     `baseImponible` (`NotaDebitoXmlSerializer::infoNotaDebito()` v2 nunca
 *     lo escribe).
 *   - `pagos[].plazo`/`unidadTiempo`: después de `total`, con
 *     `unidadTiempo` por defecto `'dias'` si `plazo` está presente
 *     (`NotaDebitoXmlSerializer` v2 nunca los escribe).
 *   - `infoAdicional` (top-level, último hijo de `<notaDebito>`, después de
 *     `motivos`): no existe en `Documents\NotaDebito`, pero sí en
 *     `NotaDebitoGenerator::generate()` (paso 4, 1.x) — ver
 *     `writeInfoAdicional()` en `common.ts`.
 *
 * `obligadoContabilidad` es obligatorio en el XSD y siempre se emite con su
 * valor por defecto (`'NO'`) cuando el documento no lo trae — igual que
 * `Documents\NotaDebito` (constructor con default) y `FacturaXmlSerializer`.
 */
export class NotaDebitoXmlSerializer {
  private static readonly VERSION = '1.0.0';
  private static readonly COD_DOC = TipoComprobante.NotaDebito;
  private static readonly SCALE_MONEY = 2;

  serialize(doc: NotaDebito, claveAcceso: string): string {
    const b = new XmlBuilder();
    const root = new XmlElement('notaDebito');
    root.setAttribute('id', 'comprobante');
    root.setAttribute('version', NotaDebitoXmlSerializer.VERSION);

    writeInfoTributaria(b, root, doc.infoTributaria, claveAcceso, NotaDebitoXmlSerializer.COD_DOC);
    this.infoNotaDebito(b, root, doc);
    this.motivos(b, root, doc);
    writeInfoAdicional(b, root, doc.infoAdicional);

    return serializeXmlDocument(root);
  }

  private infoNotaDebito(b: XmlBuilder, root: XmlElement, doc: NotaDebito): void {
    const { SCALE_MONEY } = NotaDebitoXmlSerializer;
    const node = b.child(root, 'infoNotaDebito');
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
    b.child(node, 'obligadoContabilidad', doc.obligadoContabilidad ?? 'NO');
    if (doc.rise !== undefined) {
      b.child(node, 'rise', doc.rise);
    }
    b.child(node, 'codDocModificado', doc.codDocModificado);
    b.child(node, 'numDocModificado', doc.numDocModificado);
    b.child(node, 'fechaEmisionDocSustento', doc.fechaEmisionDocSustento);
    b.child(node, 'totalSinImpuestos', formatMonto(doc.totalSinImpuestos, SCALE_MONEY));

    if (doc.impuestos.length > 0) {
      const impNode = b.child(node, 'impuestos');
      for (const imp of doc.impuestos) {
        const i = b.child(impNode, 'impuesto');
        b.child(i, 'codigo', imp.codigo);
        b.child(i, 'codigoPorcentaje', imp.codigoPorcentaje);
        if (imp.descuentoAdicional !== undefined) {
          b.child(i, 'descuentoAdicional', formatMonto(imp.descuentoAdicional, SCALE_MONEY));
        }
        b.child(i, 'baseImponible', formatMonto(imp.baseImponible, SCALE_MONEY));
        b.child(i, 'valor', formatMonto(imp.valor, SCALE_MONEY));
      }
    }

    b.child(node, 'valorTotal', formatMonto(doc.valorTotal, SCALE_MONEY));

    if (doc.pagos.length > 0) {
      const pagosNode = b.child(node, 'pagos');
      for (const pago of doc.pagos) {
        const p = b.child(pagosNode, 'pago');
        b.child(p, 'formaPago', pago.formaPago);
        b.child(p, 'total', formatMonto(pago.total, SCALE_MONEY));
        if (pago.plazo !== undefined) {
          b.child(p, 'plazo', pago.plazo);
          b.child(p, 'unidadTiempo', pago.unidadTiempo ?? 'dias');
        }
      }
    }
  }

  private motivos(b: XmlBuilder, root: XmlElement, doc: NotaDebito): void {
    const node = b.child(root, 'motivos');
    for (const motivo of doc.motivos) {
      const m = b.child(node, 'motivo');
      b.child(m, 'razon', motivo.razon);
      b.child(m, 'valor', formatMonto(motivo.valor, NotaDebitoXmlSerializer.SCALE_MONEY));
    }
  }
}
