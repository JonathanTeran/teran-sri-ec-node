import { TipoComprobante } from '../catalogs/index.js';
import type { Comprobante } from '../documents/index.js';
import { SriError } from '../errors/index.js';
import { FacturaXmlSerializer } from './factura.serializer.js';
import { GuiaRemisionXmlSerializer } from './guia-remision.serializer.js';
import { LiquidacionCompraXmlSerializer } from './liquidacion-compra.serializer.js';
import { NotaCreditoXmlSerializer } from './nota-credito.serializer.js';
import { NotaDebitoXmlSerializer } from './nota-debito.serializer.js';
import { RetencionXmlSerializer } from './retencion.serializer.js';

export * from './xml-builder.js';
export * from './common.js';
export * from './factura.serializer.js';
export * from './liquidacion-compra.serializer.js';
export * from './nota-credito.serializer.js';
export * from './nota-debito.serializer.js';
export * from './guia-remision.serializer.js';
export * from './retencion.serializer.js';

/**
 * Serializador XML para un tipo de comprobante `D` (contrato compartido,
 * `contratos.md`). Un serializador por tipo de comprobante — no hay una
 * clase genérica "un serializador para todos"; cada `codDoc` tiene su propia
 * estructura XSD.
 */
export interface XmlSerializer<D> {
  serialize(doc: D, claveAcceso: string): string;
}

/**
 * Registro `TipoComprobante` → `XmlSerializer`. Los 6 comprobantes
 * soportados por el paquete están registrados (Task 7: `Factura`; Task 8:
 * `LiquidacionCompra`, `NotaCredito`, `NotaDebito`, `GuiaRemision`,
 * `Retencion`).
 *
 * El cast `as XmlSerializer<Comprobante>` en cada entrada es necesario
 * porque cada `XmlSerializer<D>` es específico de su tipo de documento `D`
 * (p.ej. `XmlSerializer<Factura>`), pero el registro necesita una forma
 * común indexable por `TipoComprobante`; `serializerFor()` es quien
 * garantiza en tiempo de ejecución (vía el discriminante `tipo` del
 * `Comprobante` de entrada) que el documento pasado a `.serialize()`
 * corresponde al tipo real que cada serializador espera.
 */
const REGISTRY: Partial<Record<TipoComprobante, XmlSerializer<Comprobante>>> = {
  [TipoComprobante.Factura]: new FacturaXmlSerializer() as XmlSerializer<Comprobante>,
  [TipoComprobante.LiquidacionCompra]:
    new LiquidacionCompraXmlSerializer() as XmlSerializer<Comprobante>,
  [TipoComprobante.NotaCredito]: new NotaCreditoXmlSerializer() as XmlSerializer<Comprobante>,
  [TipoComprobante.NotaDebito]: new NotaDebitoXmlSerializer() as XmlSerializer<Comprobante>,
  [TipoComprobante.GuiaRemision]: new GuiaRemisionXmlSerializer() as XmlSerializer<Comprobante>,
  [TipoComprobante.Retencion]: new RetencionXmlSerializer() as XmlSerializer<Comprobante>,
};

/**
 * Devuelve el serializador XML correspondiente a `tipo`, listo para
 * serializar el documento completo. Análogo a `schemaFor()` en
 * `schemas/index.ts`. Los 6 tipos de comprobante soportados por el paquete
 * están registrados (ver `REGISTRY`).
 *
 * @throws SriError (código `UNSUPPORTED_COMPROBANTE`) si `tipo` no
 * corresponde a ninguno de los 6 comprobantes soportados. Deliberadamente
 * NO es un `ValidationError`: llegar aquí significa que el discriminante
 * `tipo` del documento no pertenece a la unión `Comprobante`, es decir un
 * error de programación (o un cast forzado), no un dato de usuario mal
 * formado. Emitirlo como `ValidationError` haría que lo tragaran los
 * manejadores que traducen validaciones a errores 4xx del usuario final, en
 * vez de aflorar como el bug que es.
 */
export function serializerFor(tipo: TipoComprobante): XmlSerializer<Comprobante> {
  const serializer = REGISTRY[tipo];
  if (!serializer) {
    throw new SriError(
      `No hay serializador XML registrado para el tipo de comprobante '${tipo}'. ` +
        'Los tipos soportados son los 6 del catálogo TipoComprobante (01, 03, 04, 05, 06, 07).',
      'UNSUPPORTED_COMPROBANTE',
    );
  }
  return serializer;
}
