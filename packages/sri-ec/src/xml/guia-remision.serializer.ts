import { TipoComprobante } from '../catalogs/index.js';
import type { GuiaRemision } from '../documents/guia-remision.js';
import { writeInfoAdicional, writeInfoTributaria } from './common.js';
import { XmlBuilder, XmlElement, serializeXmlDocument } from './xml-builder.js';

/**
 * Serializador XML de `GuiaRemision` (codDoc `06`). Port campo a campo de
 * `src/Xml/GuiaRemisionXmlSerializer.php` — misma estructura, mismo orden
 * base de elementos (`infoTributaria` → `infoGuiaRemision` →
 * `destinatarios`).
 *
 * A diferencia de Factura/LiquidacionCompra/NotaCredito/NotaDebito,
 * `Documents\GuiaRemision` (PHP) NO defaultea `obligadoContabilidad` a
 * `'NO'` (es `?string` sin valor por defecto) y
 * `GuiaRemisionXmlSerializer::infoGuiaRemision()` lo emite condicionalmente
 * (`if ($doc->obligadoContabilidad !== null)`) — igual que `Retencion`. Se
 * respeta esa diferencia aquí (sin default, solo se emite si está presente).
 *
 * `destinatario.detalles[].cantidad` se serializa tal cual (sin
 * `formatMonto`): en PHP, `Destinatario.detalles` es un array crudo
 * (`array<string,string>`, no un `Detalle` value object), y
 * `GuiaRemisionXmlSerializer::destinatarios()` hace `(string) $det['cantidad']`
 * sin pasar por `Money::format()` — se replica el mismo pass-through aquí.
 *
 * `destinatario.detalles[].detallesAdicionales` SÍ está soportado en PHP v2
 * (`GuiaRemisionXmlSerializer::destinatarios()`, bloque `detallesAdicionales`)
 * — se porta tal cual, iterando `Record<string,string>` (nombre→valor) en
 * vez del array de pares `{nombre,valor}` crudo de PHP (mismo dato,
 * distinta representación en TS, ver `documents/guia-remision.ts`).
 *
 * `infoAdicional` (top-level, último hijo de `<guiaRemision>`, después de
 * `destinatarios`): no existe en `Documents\GuiaRemision`, pero sí en
 * `GuiaRemisionGenerator::generate()` (paso 4, 1.x) — ver
 * `writeInfoAdicional()` en `common.ts`.
 */
export class GuiaRemisionXmlSerializer {
  private static readonly VERSION = '1.1.0';
  private static readonly COD_DOC = TipoComprobante.GuiaRemision;

  serialize(doc: GuiaRemision, claveAcceso: string): string {
    const b = new XmlBuilder();
    const root = new XmlElement('guiaRemision');
    root.setAttribute('id', 'comprobante');
    root.setAttribute('version', GuiaRemisionXmlSerializer.VERSION);

    writeInfoTributaria(b, root, doc.infoTributaria, claveAcceso, GuiaRemisionXmlSerializer.COD_DOC);
    this.infoGuiaRemision(b, root, doc);
    this.destinatarios(b, root, doc);
    writeInfoAdicional(b, root, doc.infoAdicional);

    return serializeXmlDocument(root);
  }

  private infoGuiaRemision(b: XmlBuilder, root: XmlElement, doc: GuiaRemision): void {
    const node = b.child(root, 'infoGuiaRemision');
    b.child(node, 'dirEstablecimiento', doc.dirEstablecimiento);
    b.child(node, 'dirPartida', doc.dirPartida);
    b.child(node, 'razonSocialTransportista', doc.razonSocialTransportista);
    b.child(node, 'tipoIdentificacionTransportista', doc.tipoIdentificacionTransportista);
    b.child(node, 'rucTransportista', doc.rucTransportista);
    if (doc.rise !== undefined) {
      b.child(node, 'rise', doc.rise);
    }
    // Sin default: a diferencia de los otros 4 comprobantes, PHP no
    // defaultea obligadoContabilidad aquí (ver doc de cabecera).
    if (doc.obligadoContabilidad !== undefined) {
      b.child(node, 'obligadoContabilidad', doc.obligadoContabilidad);
    }
    if (doc.contribuyenteEspecial !== undefined) {
      b.child(node, 'contribuyenteEspecial', doc.contribuyenteEspecial);
    }
    b.child(node, 'fechaIniTransporte', doc.fechaIniTransporte);
    b.child(node, 'fechaFinTransporte', doc.fechaFinTransporte);
    b.child(node, 'placa', doc.placa);
  }

  private destinatarios(b: XmlBuilder, root: XmlElement, doc: GuiaRemision): void {
    const destsNode = b.child(root, 'destinatarios');
    for (const dest of doc.destinatarios) {
      const destItem = b.child(destsNode, 'destinatario');
      b.child(destItem, 'identificacionDestinatario', dest.identificacionDestinatario);
      b.child(destItem, 'razonSocialDestinatario', dest.razonSocialDestinatario);
      b.child(destItem, 'dirDestinatario', dest.dirDestinatario);
      b.child(destItem, 'motivoTraslado', dest.motivoTraslado);
      if (dest.docAduaneroUnico !== undefined) {
        b.child(destItem, 'docAduaneroUnico', dest.docAduaneroUnico);
      }
      if (dest.codEstabDestino !== undefined) {
        b.child(destItem, 'codEstabDestino', dest.codEstabDestino);
      }
      if (dest.ruta !== undefined) {
        b.child(destItem, 'ruta', dest.ruta);
      }
      if (dest.codDocSustento !== undefined) {
        b.child(destItem, 'codDocSustento', dest.codDocSustento);
      }
      if (dest.numDocSustento !== undefined) {
        b.child(destItem, 'numDocSustento', dest.numDocSustento);
      }
      if (dest.numAutDocSustento !== undefined) {
        b.child(destItem, 'numAutDocSustento', dest.numAutDocSustento);
      }
      if (dest.fechaEmisionDocSustento !== undefined) {
        b.child(destItem, 'fechaEmisionDocSustento', dest.fechaEmisionDocSustento);
      }

      if (dest.detalles.length > 0) {
        const detallesNode = b.child(destItem, 'detalles');
        for (const det of dest.detalles) {
          const detItem = b.child(detallesNode, 'detalle');
          if (det.codigoInterno !== undefined) {
            b.child(detItem, 'codigoInterno', det.codigoInterno);
          }
          if (det.codigoAdicional !== undefined) {
            b.child(detItem, 'codigoAdicional', det.codigoAdicional);
          }
          b.child(detItem, 'descripcion', det.descripcion);
          // Pass-through: sin formatMonto (ver doc de cabecera).
          b.child(detItem, 'cantidad', det.cantidad);

          const daEntries = det.detallesAdicionales ? Object.entries(det.detallesAdicionales) : [];
          if (daEntries.length > 0) {
            const daNode = b.child(detItem, 'detallesAdicionales');
            for (const [nombre, valor] of daEntries) {
              const item = b.child(daNode, 'detAdicional');
              item.setAttribute('nombre', nombre);
              item.setAttribute('valor', valor);
            }
          }
        }
      }
    }
  }
}
