/**
 * Tipos del dominio de emisión (port de `src/Emission/*.php`).
 *
 * IMPORTANTE — `EmissionStatus`: los valores son identificadores INTERNOS de
 * esta librería, no necesariamente los strings crudos que devuelve el SRI en
 * el wire (p.ej. el SRI retorna "EN PROCESO" con espacio; aquí se usa
 * "EN_PROCESO" con guion bajo). La normalización wire → interno es
 * responsabilidad de `SriClient` (fuera de alcance de este módulo).
 *
 * `EmissionResult`/`Message` son interfaces planas (no clases) por decisión
 * explícita del controlador: no se porta el shim `ArrayAccess` de
 * `EmissionResult.php` (compat legacy PHP 1.x, fuera de alcance del port).
 */
export type EmissionStatus = 'AUTORIZADO' | 'RECHAZADO' | 'EN_PROCESO' | 'ERROR';

/**
 * Etapa en la que el SRI rechazó el comprobante (solo aplica cuando
 * `status === 'RECHAZADO'`): `RECEPCION` (devuelto, XML/clave inválidos,
 * nunca entró al sistema) vs `AUTORIZACION` (recibido pero no autorizado,
 * regla de negocio/duplicado).
 */
export type RejectionStage = 'RECEPCION' | 'AUTORIZACION';

export interface Message {
  identificador: string;
  mensaje: string;
  tipo?: string;
  informacionAdicional?: string;
}

export interface EmissionResult {
  status: EmissionStatus;
  claveAcceso: string;
  signedXml: string;
  numeroAutorizacion?: string;
  fechaAutorizacion?: string;
  authorizedXml?: string;
  messages: Message[];
  rejectedStage?: RejectionStage;
}
