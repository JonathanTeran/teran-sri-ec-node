import { TipoComprobante } from '../catalogs/index.js';
import type { InfoTributaria } from './shared.js';

/**
 * Línea de detalle de un {@link Destinatario} dentro de una Guía de Remisión.
 * Port de la estructura cruda que documenta `src/Documents/Destinatario.php`
 * (`@param array<int, array<string,string>> $detalles`) y que
 * `GuiaRemisionXmlSerializer::destinatarios()` escribe: es un shape distinto
 * del `Detalle` compartido (usa `codigoInterno`/`codigoAdicional`, no tiene
 * `precioUnitario`/`impuestos`, y su `detallesAdicionales` es el mismo
 * mecanismo de pares nombre/valor que en `Detalle`).
 */
export interface DestinatarioDetalle {
  codigoInterno?: string;
  codigoAdicional?: string;
  descripcion: string;
  cantidad: string;
  detallesAdicionales?: Record<string, string>;
}

/**
 * Destinatario de una Guía de Remisión (port de
 * `src/Documents/Destinatario.php`).
 */
export interface Destinatario {
  identificacionDestinatario: string;
  razonSocialDestinatario: string;
  dirDestinatario: string;
  motivoTraslado: string;
  detalles: DestinatarioDetalle[];
  docAduaneroUnico?: string;
  codEstabDestino?: string;
  ruta?: string;
  codDocSustento?: string;
  numDocSustento?: string;
  numAutDocSustento?: string;
  fechaEmisionDocSustento?: string;
}

/**
 * Guía de Remisión (codDoc `06`). Port de `src/Documents/GuiaRemision.php` +
 * `src/Xml/GuiaRemisionXmlSerializer.php`.
 *
 * `dirEstablecimiento` es obligatorio (a diferencia de otros comprobantes):
 * el constructor PHP no lo declara `nullable` y el serializador lo escribe
 * incondicionalmente.
 */
export interface GuiaRemision {
  tipo: TipoComprobante.GuiaRemision;
  infoTributaria: InfoTributaria;
  dirEstablecimiento: string;
  dirPartida: string;
  razonSocialTransportista: string;
  tipoIdentificacionTransportista: string;
  rucTransportista: string;
  fechaIniTransporte: string;
  fechaFinTransporte: string;
  placa: string;
  destinatarios: Destinatario[];
  rise?: string;
  obligadoContabilidad?: 'SI' | 'NO';
  contribuyenteEspecial?: string;
  infoAdicional?: Record<string, string>;
}
