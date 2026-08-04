import { randomInt } from 'node:crypto';

import { TipoComprobante, type Ambiente } from './catalogs/index.js';
import type { Comprobante } from './documents/index.js';
import type { EmissionResult, EmissionStatus } from './emission/index.js';
import { ValidationError } from './errors/index.js';
import { assertValid } from './schemas/index.js';
import { XadesSigner, type Certificate, type Clock } from './signing/index.js';
import { FetchSoapTransport, type AuthorizationOutcome, type SriTransport } from './transport/index.js';
import { generarClaveAcceso } from './utils/clave-acceso.js';
import { serializerFor } from './xml/index.js';

/**
 * Opciones de construcción de {@link SriClient} (contrato canónico,
 * `contratos.md`). Solo `ambiente` y `certificate` son obligatorios; el
 * resto tiene un valor por defecto listo para producción (transporte real
 * sobre `fetch`, firmador XAdES-BES con el reloj del sistema, validación
 * zod+negocio activada).
 */
export interface SriClientOptions {
  ambiente: Ambiente;
  certificate: Certificate;
  /** Por defecto `new FetchSoapTransport()` (SOAP sobre `fetch` nativo). */
  transport?: SriTransport;
  /** Por defecto `new XadesSigner(undefined, clock)`. */
  signer?: XadesSigner;
  /** Solo se usa para construir el firmador por defecto cuando no se pasa `signer` explícito. */
  clock?: Clock;
  /** `false` para saltar `assertValid()` (zod + BusinessValidator) antes de firmar. Por defecto `true`. */
  validate?: boolean;
}

/**
 * Entrada de alto nivel del paquete para emisión individual. Orquesta
 * serializar → firmar → enviar (recepción) → autorizar, análogo a
 * `Teran\Sri\SriClient` (PHP) pero soportando los 6 tipos de comprobante vía
 * {@link serializerFor} (el PHP original solo soporta `Factura`; el resto
 * queda "fase posterior" según su propio comentario — aquí ya está
 * completo).
 */
export class SriClient {
  private readonly ambiente: Ambiente;
  private readonly certificate: Certificate;
  private readonly transport: SriTransport;
  private readonly signer: XadesSigner;
  private readonly validateDoc: boolean;

  constructor(options: SriClientOptions) {
    this.ambiente = options.ambiente;
    this.certificate = options.certificate;
    this.transport = options.transport ?? new FetchSoapTransport();
    this.signer = options.signer ?? new XadesSigner(undefined, options.clock);
    this.validateDoc = options.validate ?? true;
  }

  /**
   * Emite `doc` al SRI: valida (salvo `validate: false`), calcula o reusa
   * `claveAcceso`, serializa, firma y ejecuta recepción + autorización.
   *
   * - Si la recepción no devuelve `estado === 'RECIBIDA'` (p.ej. `DEVUELTA`),
   *   el resultado es `RECHAZADO`/`RECEPCION` y **no** se llama a
   *   `autorizar` — el comprobante nunca entró al sistema del SRI.
   * - Si la recepción fue exitosa, se llama a `autorizar` y su `estado` se
   *   normaliza (case-insensitive, igual que `strtoupper()` en PHP):
   *   `AUTORIZADO` → `AUTORIZADO`; `EN PROCESO`/`EN PROCESAMIENTO` →
   *   `EN_PROCESO`; cualquier otro valor → `RECHAZADO`/`AUTORIZACION`.
   * - `CommunicationError` (fallo de red/timeout/SOAP fault) de `transport`
   *   se propaga tal cual — nunca se convierte en un `EmissionResult`, ya
   *   que a diferencia de un rechazo del SRI (una respuesta válida con un
   *   estado desfavorable), una falla de comunicación no permite saber si
   *   el comprobante llegó a procesarse.
   *
   * @param doc Comprobante a emitir (unión discriminada por `tipo`).
   * @param claveAcceso Clave de 49 dígitos ya calculada; si se omite, se
   * genera con {@link generarClaveAcceso} (fecha del propio `doc`, RUC/serie/
   * secuencial de `infoTributaria`, ambiente del cliente, código numérico
   * aleatorio de 8 dígitos).
   * @throws ValidationError si `doc` no pasa `assertValid()` (salvo
   * `validate: false`), o si `doc.infoTributaria.ambiente` no coincide con
   * el ambiente del cliente — enviar a un ambiente distinto del declarado
   * en el propio XML produciría un comprobante inconsistente que el SRI
   * rechazaría de todos modos, así que se falla rápido, antes de firmar.
   */
  async emit(doc: Comprobante, claveAcceso?: string): Promise<EmissionResult> {
    if (this.validateDoc) {
      assertValid(doc);
    }
    this.assertAmbienteConsistente(doc);

    const clave = claveAcceso ?? this.generarClaveAccesoPara(doc);

    const xml = serializerFor(doc.tipo).serialize(doc, clave);
    const signedXml = this.signer.sign(xml, this.certificate);

    const reception = await this.transport.enviar(signedXml, this.ambiente);
    if (reception.estado !== 'RECIBIDA') {
      return {
        status: 'RECHAZADO',
        claveAcceso: clave,
        signedXml,
        messages: reception.mensajes,
        rejectedStage: 'RECEPCION',
      };
    }

    const auth = await this.transport.autorizar(clave, this.ambiente);
    const status = mapEstadoAutorizacion(auth.estado);

    return {
      status,
      claveAcceso: clave,
      signedXml,
      numeroAutorizacion: auth.numeroAutorizacion,
      fechaAutorizacion: auth.fechaAutorizacion,
      authorizedXml: auth.comprobante,
      messages: auth.mensajes,
      rejectedStage: status === 'RECHAZADO' ? 'AUTORIZACION' : undefined,
    };
  }

  /** Passthrough directo a `transport.autorizar()` para consultar una clave de acceso ya emitida (p.ej. re-consultar un `EN_PROCESO`). */
  authorize(claveAcceso: string): Promise<AuthorizationOutcome> {
    return this.transport.autorizar(claveAcceso, this.ambiente);
  }

  /** Firma `xml` con el certificado del cliente, sin pasar por `enviar`/`autorizar` — útil para firmar y despachar por fuera de `emit()`. */
  sign(xml: string): string {
    return this.signer.sign(xml, this.certificate);
  }

  /**
   * `doc.infoTributaria.ambiente` debe ser el mismo que `this.ambiente`: el
   * primero queda embebido en el XML (y en la clave de acceso, si se
   * genera), el segundo decide a qué endpoint (`SRI_URLS`) se envía —
   * dejarlos divergir enviaría un comprobante marcado como "Producción" al
   * endpoint de pruebas (o viceversa), algo que el SRI rechazaría de todos
   * modos; se prefiere fallar aquí, antes de firmar, con un error claro.
   */
  private assertAmbienteConsistente(doc: Comprobante): void {
    if (doc.infoTributaria.ambiente !== this.ambiente) {
      throw new ValidationError(
        'El ambiente de infoTributaria no coincide con el ambiente configurado en SriClient',
        [
          `infoTributaria.ambiente ('${doc.infoTributaria.ambiente}') debe ser igual al ambiente del cliente ('${this.ambiente}').`,
        ],
      );
    }
  }

  /** Genera la clave de acceso de `doc` cuando el caller no provee una ya calculada. */
  private generarClaveAccesoPara(doc: Comprobante): string {
    const info = doc.infoTributaria;
    return generarClaveAcceso({
      fecha: fechaClaveAccesoDe(doc),
      tipoComprobante: doc.tipo,
      ruc: info.ruc,
      ambiente: this.ambiente,
      serie: `${info.estab}${info.ptoEmi}`,
      numero: info.secuencial,
      codigoNum: codigoNumAleatorio(),
      tipoEmision: info.tipoEmision,
    });
  }
}

/**
 * Resuelve la fecha (`dd/mm/yyyy`) que alimenta la clave de acceso de `doc`.
 * Los 5 comprobantes con fecha de emisión propia (`Factura`,
 * `LiquidacionCompra`, `NotaCredito`, `NotaDebito`, `Retencion`) usan
 * `fechaEmision`; `GuiaRemision` no modela ese campo (ver
 * `documents/guia-remision.ts` — el traslado no tiene "fecha de emisión",
 * tiene inicio/fin de transporte), así que se usa `fechaIniTransporte`, el
 * campo de fecha más cercano semánticamente disponible. No hay precedente
 * directo en el PHP para esta decisión: `SriClient::emit()` (PHP) solo
 * soporta `Factura` y recibe la clave ya calculada por el caller, y la ruta
 * legacy `SRI::procesarComprobante()` asume `fechaEmision` para los 6 tipos
 * por igual (un campo que ni siquiera existe en `GuiaRemision`) — un bug
 * latente que nunca tuvo cobertura de test en el PHP.
 */
function fechaClaveAccesoDe(doc: Comprobante): string {
  if (doc.tipo === TipoComprobante.GuiaRemision) {
    return doc.fechaIniTransporte;
  }
  return doc.fechaEmision;
}

/** Código numérico aleatorio de 8 dígitos (con ceros a la izquierda) para la clave de acceso. */
function codigoNumAleatorio(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, '0');
}

/**
 * Normaliza el `estado` crudo de `autorizar()` (wire, mayúsculas/espacios
 * variables) al `EmissionStatus` interno. Port exacto del `match
 * (strtoupper($auth->estado))` de `SriClient::emit()` (PHP): mismas tres
 * ramas, mismo `default` a `RECHAZADO`.
 */
function mapEstadoAutorizacion(estado: string): EmissionStatus {
  switch (estado.toUpperCase()) {
    case 'AUTORIZADO':
      return 'AUTORIZADO';
    case 'EN PROCESO':
    case 'EN PROCESAMIENTO':
      return 'EN_PROCESO';
    default:
      return 'RECHAZADO';
  }
}
