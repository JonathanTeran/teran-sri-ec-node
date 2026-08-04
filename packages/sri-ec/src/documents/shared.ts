import type { Ambiente, TipoEmision } from '../catalogs/index.js';

/**
 * Tipos compartidos por los 6 comprobantes electrónicos (port de
 * `src/Documents/InfoTributaria.php`, `Impuesto.php`, `Pago.php` y
 * `Detalle.php`, más los campos opcionales que los generadores 1.x
 * (`src/Generators/*.php`) leen de más).
 *
 * Convención transversal: todo monto/monto-como-string se modela como
 * `string` (nunca `number`), tal como lo escribe cada serializador PHP
 * (`Money::format()`), para no perder precisión decimal ni reintroducir
 * errores de punto flotante en el cliente.
 */

/**
 * Nodo `infoTributaria`, común a los 6 comprobantes (port de
 * `src/Documents/InfoTributaria.php`).
 *
 * `tipoEmision` es opcional porque el value object PHP lo defaultea a
 * `TipoEmision::Normal` en el constructor; `nombreComercial`,
 * `contribuyenteRimpe` y `agenteRetencion` son opcionales porque
 * `XmlGenerator::createInfoTributaria()` solo los emite si están presentes
 * (`$value !== null`).
 */
export interface InfoTributaria {
  ambiente: Ambiente;
  razonSocial: string;
  ruc: string;
  estab: string;
  ptoEmi: string;
  secuencial: string;
  dirMatriz: string;
  tipoEmision?: TipoEmision;
  nombreComercial?: string;
  contribuyenteRimpe?: string;
  agenteRetencion?: string;
}

/**
 * Impuesto de un `detalle` (línea de ítem). Port de
 * `src/Documents/Impuesto.php` tal como lo escribe `FacturaXmlSerializer::detalles()`
 * (y equivalentes): siempre emite `tarifa` (con `'0'` como default si viene
 * null en PHP), por eso aquí es obligatorio.
 */
export interface Impuesto {
  codigo: string;
  codigoPorcentaje: string;
  tarifa: string;
  baseImponible: string;
  valor: string;
}

/**
 * Impuesto agregado a nivel de comprobante (`totalConImpuestos` /
 * `infoNotaDebito.impuestos`). A diferencia de {@link Impuesto}, los
 * serializadores v2 nunca escriben `tarifa` aquí; `descuentoAdicional` es
 * un campo legado del generador 1.x (`FacturaGenerator::createInfoFactura()`),
 * opcional porque el value object v2 `Impuesto` no lo modela.
 */
export interface TotalImpuesto {
  codigo: string;
  codigoPorcentaje: string;
  baseImponible: string;
  valor: string;
  descuentoAdicional?: string;
}

/**
 * Forma de pago (port de `src/Documents/Pago.php`). `formaPago` se modela
 * como `string` (no como el tipo nominal `FormaPago` de
 * `catalogs/forma-pago.ts`) para no acoplar el shape del documento al
 * catálogo — cualquier código de 2 dígitos válido según el SRI es aceptado
 * estructuralmente aquí; la validación de catálogo es responsabilidad de
 * zod/BusinessValidator (Task 5-6).
 */
export interface Pago {
  formaPago: string;
  total: string;
  plazo?: string;
  unidadTiempo?: string;
}

/**
 * Línea de detalle (port de `src/Documents/Detalle.php`).
 * `detallesAdicionales` es el port de los pares `<detAdicional nombre="" valor="">`
 * que tanto `FacturaGenerator` como `GuiaRemisionXmlSerializer` soportan.
 */
export interface Detalle {
  codigoPrincipal?: string;
  codigoAuxiliar?: string;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  descuento: string;
  precioTotalSinImpuesto: string;
  impuestos: Impuesto[];
  detallesAdicionales?: Record<string, string>;
}
