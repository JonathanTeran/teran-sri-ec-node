import { TipoComprobante } from '../catalogs/index.js';
import type { Comprobante } from '../documents/index.js';
import { ValidationError } from '../errors/index.js';
import { FacturaXmlSerializer } from './factura.serializer.js';

export * from './xml-builder.js';
export * from './factura.serializer.js';

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
 * Registro `TipoComprobante` → `XmlSerializer`. Solo `Factura` está
 * registrado por ahora (Task 7); Task 8 añade los 5 comprobantes restantes
 * (`LiquidacionCompra`, `NotaCredito`, `NotaDebito`, `GuiaRemision`,
 * `Retencion`).
 */
const REGISTRY: Partial<Record<TipoComprobante, XmlSerializer<Comprobante>>> = {
  [TipoComprobante.Factura]: new FacturaXmlSerializer(),
};

/**
 * Devuelve el serializador XML correspondiente a `tipo`, listo para
 * serializar el documento completo. Análogo a `schemaFor()` en
 * `schemas/index.ts`.
 *
 * @throws ValidationError si `tipo` no tiene serializador registrado
 * todavía (comprobantes de Task 8 antes de que se implementen).
 */
export function serializerFor(tipo: TipoComprobante): XmlSerializer<Comprobante> {
  const serializer = REGISTRY[tipo];
  if (!serializer) {
    throw new ValidationError(
      `No hay serializador XML registrado para el tipo de comprobante '${tipo}'.`,
      [
        'Los serializadores se añaden progresivamente por tarea; verifique que el tipo sea correcto o que el comprobante ya esté soportado.',
      ],
    );
  }
  return serializer;
}
