import { TipoComprobante } from '../catalogs/index.js';
import type { Retencion } from '../documents/retencion.js';
import { writeInfoAdicional, writeInfoTributaria } from './common.js';
import { XmlBuilder, XmlElement, serializeXmlDocument } from './xml-builder.js';

/**
 * Serializador XML de `Retencion` (codDoc `07`, comprobante de retención
 * v2.0.0 con `docsSustento`). Port campo a campo de
 * `src/Xml/RetencionXmlSerializer.php` — misma estructura, mismo orden base
 * de elementos (`infoTributaria` → `infoCompRetencion` → `docsSustento`).
 *
 * Igual que `GuiaRemision`, `Documents\Retencion` (PHP) NO defaultea
 * `obligadoContabilidad` (es `?string` sin valor por defecto) —
 * `RetencionXmlSerializer::infoCompRetencion()` lo emite condicionalmente,
 * igual que aquí.
 *
 * `docSustento.totalSinImpuestos`/`importeTotal` y todos los campos de
 * `impuestosDocSustento`/`retenciones`/`pagos` se serializan tal cual (sin
 * `formatMonto`): `Documents\DocSustento` (PHP) los modela como `string`
 * crudo, no como `Money`, y `RetencionXmlSerializer::docsSustento()` nunca
 * llama a `->format()` sobre ellos — se replica el mismo pass-through.
 *
 * `impuestosDocSustento`/`retenciones`/`pagos` no tienen un catálogo fijo de
 * campos: cada fila se serializa con un `foreach` genérico clave→valor
 * (`writeRow()`), igual que el `foreach ($row as $k => $v)` de PHP —
 * cualquier campo SRI adicional presente en la fila TS (más allá de los
 * campos conocidos del tipo, vía su índice `[extra: string]: string`) se
 * serializa también, en el orden de inserción del objeto.
 *
 * `infoAdicional` (top-level, último hijo de `<comprobanteRetencion>`,
 * después de `docsSustento`): no existe en `Documents\Retencion`, pero sí en
 * `RetencionGenerator::generate()` (paso 4, 1.x) — ver
 * `writeInfoAdicional()` en `common.ts`.
 */
export class RetencionXmlSerializer {
  private static readonly VERSION = '2.0.0';
  private static readonly COD_DOC = TipoComprobante.Retencion;

  serialize(doc: Retencion, claveAcceso: string): string {
    const b = new XmlBuilder();
    const root = new XmlElement('comprobanteRetencion');
    root.setAttribute('id', 'comprobante');
    root.setAttribute('version', RetencionXmlSerializer.VERSION);

    writeInfoTributaria(b, root, doc.infoTributaria, claveAcceso, RetencionXmlSerializer.COD_DOC);
    this.infoCompRetencion(b, root, doc);
    this.docsSustento(b, root, doc);
    writeInfoAdicional(b, root, doc.infoAdicional);

    return serializeXmlDocument(root);
  }

  private infoCompRetencion(b: XmlBuilder, root: XmlElement, doc: Retencion): void {
    const node = b.child(root, 'infoCompRetencion');
    b.child(node, 'fechaEmision', doc.fechaEmision);
    b.child(node, 'dirEstablecimiento', doc.dirEstablecimiento);
    if (doc.contribuyenteEspecial !== undefined) {
      b.child(node, 'contribuyenteEspecial', doc.contribuyenteEspecial);
    }
    if (doc.obligadoContabilidad !== undefined) {
      b.child(node, 'obligadoContabilidad', doc.obligadoContabilidad);
    }
    b.child(node, 'tipoIdentificacionSujetoRetenido', doc.tipoIdentificacionSujetoRetenido);
    if (doc.tipoSujetoRetenido !== undefined) {
      b.child(node, 'tipoSujetoRetenido', doc.tipoSujetoRetenido);
    }
    if (doc.parteRel !== undefined) {
      b.child(node, 'parteRel', doc.parteRel);
    }
    b.child(node, 'razonSocialSujetoRetenido', doc.razonSocialSujetoRetenido);
    b.child(node, 'identificacionSujetoRetenido', doc.identificacionSujetoRetenido);
    b.child(node, 'periodoFiscal', doc.periodoFiscal);
  }

  private docsSustento(b: XmlBuilder, root: XmlElement, doc: Retencion): void {
    const docsNode = b.child(root, 'docsSustento');
    for (const docS of doc.docsSustento) {
      const docItem = b.child(docsNode, 'docSustento');
      b.child(docItem, 'codSustento', docS.codSustento);
      b.child(docItem, 'codDocSustento', docS.codDocSustento);
      b.child(docItem, 'numDocSustento', docS.numDocSustento);
      b.child(docItem, 'fechaEmisionDocSustento', docS.fechaEmisionDocSustento);
      if (docS.fechaRegistroContable !== undefined) {
        b.child(docItem, 'fechaRegistroContable', docS.fechaRegistroContable);
      }
      if (docS.numAutDocSustento !== undefined) {
        b.child(docItem, 'numAutDocSustento', docS.numAutDocSustento);
      }
      if (docS.pagoLocExt !== undefined) {
        b.child(docItem, 'pagoLocExt', docS.pagoLocExt);
      }
      if (docS.tipoRegi !== undefined) {
        b.child(docItem, 'tipoRegi', docS.tipoRegi);
      }
      if (docS.paisEfecPago !== undefined) {
        b.child(docItem, 'paisEfecPago', docS.paisEfecPago);
      }
      if (docS.aplicConvDobTwordsri !== undefined) {
        b.child(docItem, 'aplicConvDobTwordsri', docS.aplicConvDobTwordsri);
      }
      if (docS.pagExtSujRetNorLeg !== undefined) {
        b.child(docItem, 'pagExtSujRetNorLeg', docS.pagExtSujRetNorLeg);
      }
      if (docS.pagoRegFis !== undefined) {
        b.child(docItem, 'pagoRegFis', docS.pagoRegFis);
      }
      if (docS.totalComprobantesReembolso !== undefined) {
        b.child(docItem, 'totalComprobantesReembolso', docS.totalComprobantesReembolso);
      }
      if (docS.totalBaseImponibleReembolso !== undefined) {
        b.child(docItem, 'totalBaseImponibleReembolso', docS.totalBaseImponibleReembolso);
      }
      if (docS.totalImpuestoReembolso !== undefined) {
        b.child(docItem, 'totalImpuestoReembolso', docS.totalImpuestoReembolso);
      }
      b.child(docItem, 'totalSinImpuestos', docS.totalSinImpuestos);
      b.child(docItem, 'importeTotal', docS.importeTotal);

      if (docS.impuestosDocSustento.length > 0) {
        const impNode = b.child(docItem, 'impuestosDocSustento');
        for (const imp of docS.impuestosDocSustento) {
          this.writeRow(b, impNode, 'impuestoDocSustento', imp);
        }
      }

      if (docS.retenciones.length > 0) {
        const retNode = b.child(docItem, 'retenciones');
        for (const ret of docS.retenciones) {
          this.writeRow(b, retNode, 'retencion', ret);
        }
      }

      if (docS.pagos.length > 0) {
        const pagosNode = b.child(docItem, 'pagos');
        for (const pago of docS.pagos) {
          this.writeRow(b, pagosNode, 'pago', pago);
        }
      }
    }
  }

  /**
   * Escribe una fila genérica clave→valor (port de los tres
   * `foreach ($row as $k => $v) { $b->child($item, (string) $k, $v !== '' ? (string) $v : null); }`
   * de `RetencionXmlSerializer::docsSustento()` en PHP, para
   * `impuestosDocSustento`/`retenciones`/`pagos`): no hay un catálogo fijo de
   * campos, cualquier clave presente en la fila se serializa tal cual, en el
   * orden de inserción del objeto (igual que el `foreach` de un array
   * asociativo PHP, ambos preservan orden de inserción). `''` se coerciona a
   * `null` (elemento vacío `<el></el>`) en vez de dejar que
   * `XmlBuilder.child()` lance, igual que `$v !== '' ? (string) $v : null`
   * en PHP.
   */
  private writeRow(
    b: XmlBuilder,
    parent: XmlElement,
    name: string,
    row: Record<string, string>,
  ): void {
    const item = b.child(parent, name);
    for (const [k, v] of Object.entries(row)) {
      b.child(item, k, v !== '' ? v : null);
    }
  }
}
