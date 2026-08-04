import { TipoComprobante } from '../catalogs/index.js';
import type { LiquidacionCompra } from '../documents/liquidacion-compra.js';
import { formatMonto } from '../utils/money.js';
import { writeInfoAdicional, writeInfoTributaria } from './common.js';
import { XmlBuilder, XmlElement, serializeXmlDocument } from './xml-builder.js';

/**
 * Serializador XML de `LiquidacionCompra` (codDoc `03`). Port campo a campo
 * de `src/Xml/LiquidacionCompraXmlSerializer.php` — misma estructura, mismo
 * orden base de elementos (`infoTributaria` → `infoLiquidacionCompra` →
 * `detalles`).
 *
 * Campos opcionales del XSD oficial (`resources/xsd/liquidacionCompra_v1.1.0.xsd`
 * — el único XSD 1.1.0 disponible en el repo PHP hermano, y por tanto la
 * fuente de verdad más fuerte para esta familia de comprobantes) que el
 * value object v2 de PHP (`Documents\LiquidacionCompra`) NO modela pero que
 * SÍ escribe el generador 1.x (`LiquidacionCompraGenerator.php`) cuando
 * están presentes. Este serializador los emite si el documento TS los trae,
 * en la posición verificada contra el XSD:
 *
 *   - `infoLiquidacionCompra.totalConImpuestos[].descuentoAdicional`:
 *     `minOccurs="0"`, entre `codigoPorcentaje` y `baseImponible`
 *     (`Documents\Impuesto` de PHP no tiene este campo en absoluto).
 *   - `detalles[].detallesAdicionales`: `minOccurs="0"`, entre
 *     `precioTotalSinImpuesto` e `impuestos` (`Documents\Detalle` de PHP no
 *     lo modela).
 *   - `infoAdicional` (top-level, último hijo de `<liquidacionCompra>`): no
 *     existe en `Documents\LiquidacionCompra`, pero sí en el XSD y en
 *     `LiquidacionCompraGenerator::generate()` (paso 4) — ver
 *     `writeInfoAdicional()` en `common.ts`.
 *
 * `infoLiquidacionCompra.pagos[].plazo`/`unidadTiempo` SÍ son representables
 * en PHP v2 (`Documents\Pago` los modela) y `LiquidacionCompraXmlSerializer`
 * ya los serializa condicionalmente — se portan aquí tal cual (mismo
 * default `'dias'` si `plazo` está presente pero `unidadTiempo` no).
 *
 * `obligadoContabilidad`/`moneda` son obligatorios en el XSD y siempre se
 * emiten con su valor por defecto (`'NO'`/`'DOLAR'`) cuando el documento no
 * los trae — igual que `Documents\LiquidacionCompra` (constructor con
 * default) y `FacturaXmlSerializer` (Task 7). `pagos` se emite siempre
 * (wrapper incondicional), igual que `LiquidacionCompraXmlSerializer` (PHP
 * nunca comprueba `!== []` para este comprobante, a diferencia de
 * `NotaDebitoXmlSerializer`).
 */
export class LiquidacionCompraXmlSerializer {
  private static readonly VERSION = '1.1.0';
  private static readonly COD_DOC = TipoComprobante.LiquidacionCompra;
  private static readonly SCALE_MONEY = 2;
  private static readonly SCALE_QUANTITY = 6;

  serialize(doc: LiquidacionCompra, claveAcceso: string): string {
    const b = new XmlBuilder();
    const root = new XmlElement('liquidacionCompra');
    root.setAttribute('id', 'comprobante');
    root.setAttribute('version', LiquidacionCompraXmlSerializer.VERSION);

    writeInfoTributaria(
      b,
      root,
      doc.infoTributaria,
      claveAcceso,
      LiquidacionCompraXmlSerializer.COD_DOC,
    );
    this.infoLiquidacionCompra(b, root, doc);
    this.detalles(b, root, doc);
    writeInfoAdicional(b, root, doc.infoAdicional);

    return serializeXmlDocument(root);
  }

  private infoLiquidacionCompra(b: XmlBuilder, root: XmlElement, doc: LiquidacionCompra): void {
    const { SCALE_MONEY } = LiquidacionCompraXmlSerializer;
    const node = b.child(root, 'infoLiquidacionCompra');
    b.child(node, 'fechaEmision', doc.fechaEmision);
    if (doc.dirEstablecimiento !== undefined) {
      b.child(node, 'dirEstablecimiento', doc.dirEstablecimiento);
    }
    if (doc.contribuyenteEspecial !== undefined) {
      b.child(node, 'contribuyenteEspecial', doc.contribuyenteEspecial);
    }
    b.child(node, 'obligadoContabilidad', doc.obligadoContabilidad ?? 'NO');
    b.child(node, 'tipoIdentificacionProveedor', doc.tipoIdentificacionProveedor);
    b.child(node, 'razonSocialProveedor', doc.razonSocialProveedor);
    b.child(node, 'identificacionProveedor', doc.identificacionProveedor);
    if (doc.direccionProveedor !== undefined) {
      b.child(node, 'direccionProveedor', doc.direccionProveedor);
    }
    b.child(node, 'totalSinImpuestos', formatMonto(doc.totalSinImpuestos, SCALE_MONEY));
    b.child(node, 'totalDescuento', formatMonto(doc.totalDescuento, SCALE_MONEY));

    const tci = b.child(node, 'totalConImpuestos');
    for (const imp of doc.totalConImpuestos) {
      const ti = b.child(tci, 'totalImpuesto');
      b.child(ti, 'codigo', imp.codigo);
      b.child(ti, 'codigoPorcentaje', imp.codigoPorcentaje);
      // Orden XSD (complexType totalImpuesto, liquidacionCompra_v1.1.0.xsd):
      // codigoPorcentaje → descuentoAdicional? → baseImponible.
      if (imp.descuentoAdicional !== undefined) {
        b.child(ti, 'descuentoAdicional', formatMonto(imp.descuentoAdicional, SCALE_MONEY));
      }
      b.child(ti, 'baseImponible', formatMonto(imp.baseImponible, SCALE_MONEY));
      b.child(ti, 'valor', formatMonto(imp.valor, SCALE_MONEY));
    }

    b.child(node, 'importeTotal', formatMonto(doc.importeTotal, SCALE_MONEY));
    b.child(node, 'moneda', doc.moneda ?? 'DOLAR');

    const pagos = b.child(node, 'pagos');
    for (const pago of doc.pagos) {
      const p = b.child(pagos, 'pago');
      b.child(p, 'formaPago', pago.formaPago);
      b.child(p, 'total', formatMonto(pago.total, SCALE_MONEY));
      // Port de `if ($pago->plazo !== null) { plazo; unidadTiempo ?? 'dias'; }`.
      if (pago.plazo !== undefined) {
        b.child(p, 'plazo', pago.plazo);
        b.child(p, 'unidadTiempo', pago.unidadTiempo ?? 'dias');
      }
    }
  }

  private detalles(b: XmlBuilder, root: XmlElement, doc: LiquidacionCompra): void {
    const { SCALE_MONEY, SCALE_QUANTITY } = LiquidacionCompraXmlSerializer;
    const node = b.child(root, 'detalles');
    for (const det of doc.detalles) {
      const d = b.child(node, 'detalle');
      // `codigoPrincipal` es obligatorio y no vacío en el XSD y en
      // `Documents\Detalle` de PHP; el tipo TS lo modela opcional, así que
      // ausencia se trata como '' y XmlBuilder la rechaza (mismo criterio
      // que `FacturaXmlSerializer`).
      b.child(d, 'codigoPrincipal', det.codigoPrincipal ?? '');
      if (det.codigoAuxiliar !== undefined) {
        b.child(d, 'codigoAuxiliar', det.codigoAuxiliar);
      }
      b.child(d, 'descripcion', det.descripcion);
      b.child(d, 'cantidad', formatMonto(det.cantidad, SCALE_QUANTITY));
      b.child(d, 'precioUnitario', formatMonto(det.precioUnitario, SCALE_QUANTITY));
      b.child(d, 'descuento', formatMonto(det.descuento, SCALE_MONEY));
      b.child(d, 'precioTotalSinImpuesto', formatMonto(det.precioTotalSinImpuesto, SCALE_MONEY));

      // Orden XSD: precioTotalSinImpuesto → detallesAdicionales? → impuestos.
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
}
