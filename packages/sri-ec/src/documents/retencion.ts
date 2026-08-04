import { TipoComprobante } from '../catalogs/index.js';
import type { InfoTributaria } from './shared.js';

/**
 * Documento sustento de un Comprobante de Retención (port de
 * `src/Documents/DocSustento.php`, v2.0.0).
 *
 * `impuestosDocSustento`, `retenciones` y `pagos` se modelan como filas
 * "crudas" (`Record<string,string>`) — igual que el value object PHP, que
 * las documenta como `array<int, array<string,string>>` y las serializa con
 * un `foreach ($row as $k => $v)` genérico (`RetencionXmlSerializer::docsSustento()`)
 * para garantizar paridad exacta con el generador 1.x sin tener que fijar
 * de antemano el catálogo completo de nombres de campo del SRI (p.ej.
 * `codigoRetencion`, `porcentajeRetener`, `valorRetenido`, `formaPago`,
 * `total`). Las claves deben ser nombres XML válidos (NCName).
 */
export interface DocSustento {
  codSustento: string;
  codDocSustento: string;
  numDocSustento: string;
  fechaEmisionDocSustento: string;
  totalSinImpuestos: string;
  importeTotal: string;
  impuestosDocSustento: Record<string, string>[];
  retenciones: Record<string, string>[];
  pagos: Record<string, string>[];
  fechaRegistroContable?: string;
  numAutDocSustento?: string;
  pagoLocExt?: string;
  tipoRegi?: string;
  paisEfecPago?: string;
  aplicConvDobTwordsri?: string;
  pagExtSujRetNorLeg?: string;
  pagoRegFis?: string;
  totalComprobantesReembolso?: string;
  totalBaseImponibleReembolso?: string;
  totalImpuestoReembolso?: string;
}

/**
 * Comprobante de Retención (codDoc `07`). Port de
 * `src/Documents/Retencion.php` + `src/Xml/RetencionXmlSerializer.php`.
 *
 * `dirEstablecimiento` es obligatorio (igual que en GuiaRemision): el
 * serializador lo escribe incondicionalmente.
 */
export interface Retencion {
  tipo: TipoComprobante.Retencion;
  infoTributaria: InfoTributaria;
  fechaEmision: string;
  dirEstablecimiento: string;
  tipoIdentificacionSujetoRetenido: string;
  razonSocialSujetoRetenido: string;
  identificacionSujetoRetenido: string;
  periodoFiscal: string;
  docsSustento: DocSustento[];
  contribuyenteEspecial?: string;
  obligadoContabilidad?: 'SI' | 'NO';
  tipoSujetoRetenido?: string;
  parteRel?: string;
  infoAdicional?: Record<string, string>;
}
