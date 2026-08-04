import { TipoComprobante, TipoEmision } from '../catalogs/index.js';
import type { Factura } from '../documents/factura.js';
import { formatMonto } from '../utils/money.js';
import { XmlBuilder, XmlElement, serializeXmlDocument } from './xml-builder.js';

/**
 * Serializador XML de `Factura` (codDoc `01`). Port campo a campo de
 * `src/Xml/FacturaXmlSerializer.php` — misma estructura, mismo orden de
 * elementos (`infoTributaria` → `infoFactura` → `detalles`), mismos valores
 * literales/hardcodeados (`propina`, `moneda`, `codDoc`, `version`).
 *
 * Subconjunto representable respecto al fixture TS (`documents.test.ts`,
 * `facturaFixture`): el value object v2 de PHP (`Documents\Factura`) y su
 * serializador NO modelan `direccionComprador`, `guiaRemision` ni
 * `infoAdicional` (no existen como parámetro/campo en absoluto), y escriben
 * `propina`/`moneda` como literales fijos ignorando cualquier valor que
 * traiga el documento. Este serializador replica exactamente ese
 * comportamiento — esos 5 campos opcionales del tipo TS `Factura` se leen
 * pero NUNCA se emiten (o se ignoran a favor del literal), para mantener
 * paridad byte-a-byte con el fixture dorado generado por PHP
 * (`scripts/gen-fixtures.php` → `test/fixtures/factura.xml`).
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
  }

  private infoFactura(b: XmlBuilder, root: XmlElement, f: Factura): void {
    const { SCALE_MONEY } = FacturaXmlSerializer;
    const node = b.child(root, 'infoFactura');
    b.child(node, 'fechaEmision', f.fechaEmision);
    // El constructor v2 de PHP defaultea obligadoContabilidad a 'NO'.
    b.child(node, 'obligadoContabilidad', f.obligadoContabilidad ?? 'NO');
    b.child(node, 'tipoIdentificacionComprador', f.tipoIdentificacionComprador);
    b.child(node, 'razonSocialComprador', f.razonSocialComprador);
    b.child(node, 'identificacionComprador', f.identificacionComprador);
    b.child(node, 'totalSinImpuestos', formatMonto(f.totalSinImpuestos, SCALE_MONEY));
    b.child(node, 'totalDescuento', formatMonto(f.totalDescuento, SCALE_MONEY));

    const tci = b.child(node, 'totalConImpuestos');
    for (const imp of f.totalConImpuestos) {
      const ti = b.child(tci, 'totalImpuesto');
      b.child(ti, 'codigo', imp.codigo);
      b.child(ti, 'codigoPorcentaje', imp.codigoPorcentaje);
      b.child(ti, 'baseImponible', formatMonto(imp.baseImponible, SCALE_MONEY));
      b.child(ti, 'valor', formatMonto(imp.valor, SCALE_MONEY));
    }

    // `propina` y `moneda`: FacturaXmlSerializer::infoFactura() en PHP
    // escribe SIEMPRE estos literales, sin leerlos del objeto Factura (que
    // ni los modela) — se replica el mismo hardcodeo aquí, ignorando
    // `f.propina`/`f.moneda` si vinieran presentes en el documento TS.
    b.child(node, 'propina', '0.00');
    b.child(node, 'importeTotal', formatMonto(f.importeTotal, SCALE_MONEY));
    b.child(node, 'moneda', 'DOLAR');

    const pagos = b.child(node, 'pagos');
    for (const pago of f.pagos) {
      const p = b.child(pagos, 'pago');
      b.child(p, 'formaPago', pago.formaPago);
      b.child(p, 'total', formatMonto(pago.total, SCALE_MONEY));
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
