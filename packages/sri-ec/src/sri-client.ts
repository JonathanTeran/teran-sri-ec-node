import { randomInt } from 'node:crypto';

import { TipoComprobante, type Ambiente } from './catalogs/index.js';
import type { Comprobante } from './documents/index.js';
import type { EmissionResult, EmissionStatus } from './emission/index.js';
import { CommunicationError, ValidationError } from './errors/index.js';
import { assertValid } from './schemas/index.js';
import { XadesSigner, type Certificate, type Clock } from './signing/index.js';
import { FetchSoapTransport, type AuthorizationOutcome, type SriTransport } from './transport/index.js';
import { calcularDigitoVerificador, generarClaveAcceso } from './utils/clave-acceso.js';
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
 * Comprobante ya listo para despachar: el par `claveAcceso`/`signedXml` que
 * produce {@link SriClient.prepare}. Es la única evidencia recuperable de un
 * comprobante — persístalo antes de enviarlo.
 */
export interface PreparedComprobante {
  /** Clave de acceso de 49 dígitos embebida en el XML firmado. */
  claveAcceso: string;
  /** XML del comprobante ya serializado y firmado (XAdES-BES). */
  signedXml: string;
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
   * Valida, calcula (o verifica) la clave de acceso, serializa y firma `doc`
   * — todo lo que hace {@link emit} **antes** de tocar la red — y devuelve el
   * par `{ claveAcceso, signedXml }`.
   *
   * Es la vía soportada para obtener un comprobante firmado sin emitirlo:
   * alimentar un {@link BatchEmitter} (`batch.add(claveAcceso, signedXml)`),
   * encolarlo en un worker, archivarlo, o despacharlo con un transporte
   * propio. Reimplementarlo por fuera no es viable: la generación de la clave
   * (código numérico aleatorio, fecha por tipo de comprobante — `GuiaRemision`
   * usa `fechaIniTransporte`, no `fechaEmision`) es privada por diseño.
   *
   * **Persista el resultado antes de enviarlo.** Una vez que el XML sale a la
   * red, la `claveAcceso` es el único identificador con el que se puede
   * resolver el comprobante ante el SRI (`authorize()`).
   *
   * @param doc Comprobante a preparar (unión discriminada por `tipo`).
   * @param claveAcceso Clave de 49 dígitos ya calculada; si se omite, se
   * genera. Si se provee, se verifica (formato, dígito verificador y
   * coherencia con los campos del documento) — ver {@link emit}.
   * @throws ValidationError si `doc` no pasa `assertValid()` (salvo
   * `validate: false`), si el ambiente no coincide, o si la `claveAcceso`
   * provista es inválida o contradice al documento.
   */
  prepare(doc: Comprobante, claveAcceso?: string): PreparedComprobante {
    if (this.validateDoc) {
      assertValid(doc);
    }
    this.assertAmbienteConsistente(doc);

    const clave =
      claveAcceso === undefined
        ? this.generarClaveAccesoPara(doc)
        : this.assertClaveAccesoCoherente(claveAcceso, doc);

    const xml = serializerFor(doc.tipo).serialize(doc, clave);
    return { claveAcceso: clave, signedXml: this.signer.sign(xml, this.certificate) };
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
   *   se propaga — nunca se convierte en un `EmissionResult`, ya que a
   *   diferencia de un rechazo del SRI (una respuesta válida con un estado
   *   desfavorable), una falla de comunicación no permite saber si el
   *   comprobante llegó a procesarse. El error se re-lanza **enriquecido**
   *   con `claveAcceso` y `signedXml` (ver {@link CommunicationError}).
   *
   * ⚠️ **Ante un `CommunicationError`, el caller DEBE persistir
   * `err.claveAcceso` y `err.signedXml` antes de reintentar nada**, y
   * resolver el estado real del comprobante con
   * `authorize(err.claveAcceso)` — **nunca** con un `emit()` nuevo: cada
   * llamada genera un código numérico aleatorio distinto, así que un reintento
   * produciría otra clave de acceso, dejaría el comprobante original
   * irresoluble ante el SRI (que puede haberlo aceptado) y duplicaría el
   * secuencial. Si necesita el par clave/XML por adelantado en vez de
   * rescatarlo del error, use {@link prepare}.
   *
   * @param doc Comprobante a emitir (unión discriminada por `tipo`).
   * @param claveAcceso Clave de 49 dígitos ya calculada; si se omite, se
   * genera con {@link generarClaveAcceso} (fecha del propio `doc`, RUC/serie/
   * secuencial de `infoTributaria`, ambiente del cliente, código numérico
   * aleatorio de 8 dígitos). Si se provee, se verifica: 49 dígitos, dígito
   * verificador Módulo 11 correcto, y coherencia campo a campo con el
   * documento (fecha, tipo de comprobante, RUC, ambiente, serie y
   * secuencial) — una clave arbitraria quedaría firmada dentro del XML.
   * @throws ValidationError si `doc` no pasa `assertValid()` (salvo
   * `validate: false`), si `doc.infoTributaria.ambiente` no coincide con
   * el ambiente del cliente — enviar a un ambiente distinto del declarado
   * en el propio XML produciría un comprobante inconsistente que el SRI
   * rechazaría de todos modos, así que se falla rápido, antes de firmar —, o
   * si la `claveAcceso` provista es inválida o contradice al documento.
   */
  async emit(doc: Comprobante, claveAcceso?: string): Promise<EmissionResult> {
    const { claveAcceso: clave, signedXml } = this.prepare(doc, claveAcceso);

    const reception = await withComprobanteContext(clave, signedXml, () =>
      this.transport.enviar(signedXml, this.ambiente),
    );
    if (reception.estado !== 'RECIBIDA') {
      return {
        status: 'RECHAZADO',
        claveAcceso: clave,
        signedXml,
        messages: reception.mensajes,
        rejectedStage: 'RECEPCION',
      };
    }

    const auth = await withComprobanteContext(clave, signedXml, () =>
      this.transport.autorizar(clave, this.ambiente),
    );
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

  /**
   * Verifica una `claveAcceso` provista por el caller antes de que quede
   * embebida (y firmada) dentro del XML. Sin esto, `emit(doc, 'BASURA')`
   * produciría un comprobante firmado con una clave que el SRI rechaza — o,
   * peor, una clave sintácticamente válida pero de otro documento.
   *
   * Se comprueban, en orden: formato (49 dígitos exactos), dígito verificador
   * Módulo 11 sobre los primeros 48, y coherencia de los campos embebidos
   * contra el documento según el layout de la ficha técnica del SRI:
   *
   * ```
   * [0,8)  fecha ddmmyyyy   [8,10) codDoc      [10,23) RUC     [23,24) ambiente
   * [24,30) estab+ptoEmi    [30,39) secuencial [39,47) código numérico
   * [47,48) tipoEmisión     [48,49) dígito verificador
   * ```
   *
   * El código numérico (aleatorio por definición) y el tipo de emisión no se
   * cotejan: el primero no tiene contraparte en el documento y el segundo ya
   * queda cubierto por el dígito verificador si el caller derivó la clave del
   * mismo `infoTributaria`.
   */
  private assertClaveAccesoCoherente(claveAcceso: string, doc: Comprobante): string {
    if (!/^\d{49}$/.test(claveAcceso)) {
      throw new ValidationError('Clave de acceso inválida', [
        `claveAcceso debe tener exactamente 49 dígitos (recibido: ${claveAcceso.length} caracteres).`,
      ]);
    }

    const base48 = claveAcceso.slice(0, 48);
    const dv = claveAcceso.slice(48);
    const esperado = String(calcularDigitoVerificador(base48));
    if (dv !== esperado) {
      throw new ValidationError('Clave de acceso inválida', [
        `El dígito verificador de claveAcceso es '${dv}' pero el Módulo 11 sobre los primeros 48 dígitos da '${esperado}'.`,
      ]);
    }

    const info = doc.infoTributaria;
    const esperados: Array<[campo: string, enClave: string, enDocumento: string]> = [
      ['fecha (ddmmyyyy)', claveAcceso.slice(0, 8), fechaClaveAccesoDe(doc).replace(/\//g, '')],
      ['tipo de comprobante (codDoc)', claveAcceso.slice(8, 10), doc.tipo],
      ['ruc', claveAcceso.slice(10, 23), info.ruc],
      ['ambiente', claveAcceso.slice(23, 24), this.ambiente],
      ['serie (estab + ptoEmi)', claveAcceso.slice(24, 30), `${info.estab}${info.ptoEmi}`],
      ['secuencial', claveAcceso.slice(30, 39), info.secuencial],
    ];

    const errores = esperados
      .filter(([, enClave, enDocumento]) => enClave !== enDocumento)
      .map(
        ([campo, enClave, enDocumento]) =>
          `claveAcceso declara ${campo} = '${enClave}' pero el comprobante dice '${enDocumento}'.`,
      );

    if (errores.length > 0) {
      throw new ValidationError('Clave de acceso incoherente con el comprobante', errores);
    }

    return claveAcceso;
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

/**
 * Ejecuta `op` adjuntando `claveAcceso`/`signedXml` a cualquier
 * `CommunicationError` que escape. Sin esto, un timeout en `enviar()`/
 * `autorizar()` destruiría la única evidencia del comprobante: el caller se
 * quedaría sin la clave con la que consultar al SRI (que puede haberlo
 * aceptado) y sin el XML firmado. Se preserva el `cause` original —
 * encadenando al error de transporte si este no traía uno propio.
 */
async function withComprobanteContext<T>(
  claveAcceso: string,
  signedXml: string,
  op: () => Promise<T>,
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof CommunicationError) {
      throw new CommunicationError(err.message, err.cause ?? err, { claveAcceso, signedXml });
    }
    throw err;
  }
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
