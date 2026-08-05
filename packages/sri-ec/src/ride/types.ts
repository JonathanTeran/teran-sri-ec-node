import type { Ambiente, TipoEmision } from '../catalogs/index.js';
import type { Comprobante, TotalImpuesto } from '../documents/index.js';

/**
 * Tipos públicos e internos del submódulo RIDE (port funcional, no de PHP:
 * es una capa nueva). `RideOptions` es la API pública que describe el plan
 * (`docs/plans/2026-08-04-ride.md`); el resto son los contratos de datos que
 * consumen los helpers de `blocks.ts` — pensados para que cada
 * `*.ride.ts` (factura en Task 1; los otros 5 en Task 2) solo tenga que
 * mapear su propio shape de documento a estas formas normalizadas, sin que
 * `blocks.ts` necesite conocer los 6 tipos de `Comprobante`.
 */

/** Tamaño de página soportado por el RIDE. */
export type TamanoPaginaRide = 'A4' | 'LETTER';

/**
 * Datos de autorización del SRI para el comprobante. Si {@link RideOptions.autorizacion}
 * no se pasa, el RIDE se genera igual (Task 1, test "sin autorización") pero
 * marcado como no autorizado — el SRI autoriza de forma asíncrona y el RIDE
 * suele imprimirse antes de recibir la respuesta.
 */
export interface AutorizacionRide {
  /** Número de autorización (normalmente igual a la clave de acceso de 49 dígitos). */
  numero: string;
  /** Fecha y hora de autorización, en el formato que entregue el SRI. */
  fecha: string;
}

/** Opciones de formato del RIDE. */
export interface OpcionesFormatoRide {
  /** Tamaño de página. @default 'A4' */
  tamano?: TamanoPaginaRide;
  /** Si se dibuja el código QR de la clave de acceso. @default true */
  incluirQr?: boolean;
}

/**
 * Opciones de {@link generarRide}/`generarRide<Tipo>`. Genérica sobre `T`
 * para que cada renderer por tipo (`factura.ride.ts`, etc.) reciba
 * `RideOptions<Factura>` ya angostado por el despachador (`index.ts`) en vez
 * de tener que volver a discriminar la unión `Comprobante`.
 */
export interface RideOptions<T extends Comprobante = Comprobante> {
  documento: T;
  /** Clave de acceso (49 dígitos): se imprime en la cabecera y se codifica en el QR. */
  claveAcceso: string;
  autorizacion?: AutorizacionRide;
  /** Logo del emisor (PNG/JPG), opcional. */
  logo?: Uint8Array;
  opciones?: OpcionesFormatoRide;
}

/**
 * Datos ya normalizados del bloque "emisor" (columna izquierda de la
 * cabecera, ver "Bloques obligatorios del RIDE" en el plan).
 *
 * `dirEstablecimiento` y `contribuyenteEspecial` NO viven en el
 * `InfoTributaria` compartido (`documents/shared.ts`) sino en cada tipo de
 * comprobante por separado (y `Factura` ni siquiera los modela) — este
 * contrato es el punto donde cada `*.ride.ts` homogeneiza esa diferencia
 * antes de llamar a `drawEmisor`.
 */
export interface EmisorRide {
  logo?: Uint8Array;
  razonSocial: string;
  nombreComercial?: string;
  dirMatriz: string;
  dirEstablecimiento?: string;
  obligadoContabilidad?: 'SI' | 'NO';
  contribuyenteEspecial?: string;
  agenteRetencion?: string;
  contribuyenteRimpe?: string;
}

/** Datos del bloque "comprobante" (columna derecha de la cabecera): RUC, número, autorización, QR. */
export interface ComprobanteRide {
  ruc: string;
  /** Nombre legible del documento: "FACTURA", "NOTA DE CRÉDITO", etc. Ver `nombreDocumento()` en `blocks.ts`. */
  nombreDocumento: string;
  /** `estab-ptoEmi-secuencial`. */
  numero: string;
  ambiente: Ambiente;
  tipoEmision: TipoEmision;
  claveAcceso: string;
  autorizacion?: AutorizacionRide;
}

/**
 * Datos del bloque "comprador". Reutilizable por los otros 5 comprobantes
 * (Task 2) cambiando la etiqueta: proveedor (liquidación de compra), sujeto
 * retenido (retención), destinatario (guía de remisión) — de ahí
 * `etiquetaSujeto`, que por defecto es "Razón Social / Nombres".
 */
export interface CompradorRide {
  /** Etiqueta del bloque completo: "Comprador", "Proveedor", "Sujeto Retenido", etc. @default 'Comprador' */
  etiquetaSujeto?: string;
  razonSocial: string;
  identificacion: string;
  fechaEmision: string;
  direccion?: string;
  guiaRemision?: string;
}

/**
 * Rectángulo de dibujo que cada `draw*` de `blocks.ts` recibe: dónde empezar
 * (`x`, `y`) y cuánto ancho tiene disponible. Cada helper devuelve el `y`
 * final (borde inferior de lo que dibujó) para que el caller arme el
 * siguiente `AreaRide` encadenando bloques verticalmente — es el único
 * "motor de layout" de este submódulo, deliberadamente simple: no hay
 * flexbox ni cálculo de altura disponible restante, cada `*.ride.ts` decide
 * el orden y el ancho de columnas de su propio cuerpo.
 */
export interface AreaRide {
  x: number;
  y: number;
  width: number;
}

/**
 * Datos del bloque "totales". `impuestos` es deliberadamente
 * {@link TotalImpuesto}`[]` (no `Impuesto[]`, que sí trae `tarifa`) porque es
 * el shape que comparten `Factura.totalConImpuestos`,
 * `LiquidacionCompra.totalConImpuestos`, `NotaCredito.totalConImpuestos` y
 * `NotaDebito.impuestos` — `drawTotales` deriva la tarifa a partir de
 * `codigoPorcentaje` (ver `LABEL_CODIGO_PORCENTAJE` en `blocks.ts`), no la
 * necesita como campo aparte.
 *
 * `totalDescuento` es opcional (fix round 1, hallazgo confirmado del
 * reviewer): `NotaCredito` y `NotaDebito` no lo modelan en absoluto (la
 * primera tiene `valorModificacion`, la segunda `valorTotal`, sin
 * `totalDescuento`) — de haber sido obligatorio, Task 2 habría tenido que
 * inventar un `'0.00'` sin respaldo en el documento real. `drawTotales` omite
 * la línea "Total descuento" cuando está ausente.
 */
export interface TotalesRide {
  impuestos: TotalImpuesto[];
  totalSinImpuestos: string;
  totalDescuento?: string;
  propina?: string;
  importeTotal: string;
}
