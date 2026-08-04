/**
 * Jerarquía de errores del paquete. Todas las subclases exponen un `code`
 * literal discriminante para permitir `switch`/narrowing por tipo de error
 * sin recurrir a `instanceof` en cadenas de manejo genéricas.
 *
 * Nota de implementación: aunque `target: ES2022` hace que extender `Error`
 * con clases nativas ya mantenga la cadena de prototipos correctamente (a
 * diferencia del downlevel a ES5), se llama explícitamente a
 * `Object.setPrototypeOf` en cada constructor para blindar el comportamiento
 * de `instanceof` ante cualquier entorno de ejecución no estándar (bundlers
 * que transpilen a un target inferior, realms distintos, etc.). Ver
 * `test/errors.test.ts` para la verificación.
 */
export class SriError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'SriError';
    Object.setPrototypeOf(this, SriError.prototype);
  }
}

/**
 * Error de validación (estructural o de negocio). `errors` contiene el
 * detalle de cada violación individual; se concatenan en `message` para que
 * loguear/lanzar la excepción sin inspeccionar `.errors` siga siendo útil.
 */
export class ValidationError extends SriError {
  declare readonly code: 'VALIDATION';
  readonly errors: string[];

  constructor(message: string, errors: string[]) {
    super(errors.length > 0 ? `${message}: ${errors.join('; ')}` : message, 'VALIDATION');
    this.errors = errors;
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/** Error al cargar/parsear un certificado (p12 inválido, contraseña incorrecta, etc.). */
export class CertificateError extends SriError {
  declare readonly code: 'CERTIFICATE';

  constructor(message: string) {
    super(message, 'CERTIFICATE');
    this.name = 'CertificateError';
    Object.setPrototypeOf(this, CertificateError.prototype);
  }
}

/** Error durante la firma XAdES-BES del comprobante. */
export class SignatureError extends SriError {
  declare readonly code: 'SIGNATURE';

  constructor(message: string) {
    super(message, 'SIGNATURE');
    this.name = 'SignatureError';
    Object.setPrototypeOf(this, SignatureError.prototype);
  }
}

/**
 * Contexto del comprobante que se estaba emitiendo cuando falló la
 * comunicación. Lo adjunta {@link SriClient.emit} para que un fallo de red
 * NO destruya la única evidencia del comprobante: el par
 * `claveAcceso`/`signedXml`.
 */
export interface CommunicationErrorContext {
  /** Clave de acceso (49 dígitos) del comprobante en vuelo. */
  claveAcceso?: string;
  /** XML ya firmado que se estaba enviando (o cuya autorización se consultaba). */
  signedXml?: string;
}

/**
 * Error de transporte al comunicarse con el SRI (timeout, red caída, SOAP
 * fault, etc.). `cause` conserva el error original para diagnóstico.
 *
 * Cuando el error escapa de `SriClient.emit()`, `claveAcceso`/`signedXml`
 * traen el comprobante que estaba en vuelo. **Persista ambos antes de
 * reintentar**: el SRI puede haber recibido y aceptado el comprobante aunque
 * la respuesta se haya perdido, y un `emit()` nuevo generaría una clave de
 * acceso distinta (el código numérico es aleatorio por llamada), dejando el
 * documento original irresoluble y duplicando el secuencial. Para resolver el
 * estado real use `SriClient.authorize(claveAcceso)`.
 */
export class CommunicationError extends SriError {
  declare readonly code: 'COMMUNICATION';
  readonly cause?: unknown;
  /** Clave de acceso del comprobante en vuelo, si el error viene de `emit()`. */
  readonly claveAcceso?: string;
  /** XML firmado del comprobante en vuelo, si el error viene de `emit()`. */
  readonly signedXml?: string;

  constructor(message: string, cause?: unknown, context?: CommunicationErrorContext) {
    super(message, 'COMMUNICATION');
    this.cause = cause;
    if (context?.claveAcceso !== undefined) {
      this.claveAcceso = context.claveAcceso;
    }
    if (context?.signedXml !== undefined) {
      this.signedXml = context.signedXml;
    }
    this.name = 'CommunicationError';
    Object.setPrototypeOf(this, CommunicationError.prototype);
  }
}
