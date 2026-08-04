import { TipoComprobante } from '../catalogs/index.js';
import type { Detalle, InfoTributaria, TotalImpuesto } from './shared.js';

/**
 * Nota de Crédito (codDoc `04`). Port de `src/Documents/NotaCredito.php` +
 * `src/Xml/NotaCreditoXmlSerializer.php`.
 *
 * Añade sobre Factura: `codDocModificado`/`numDocModificado`/
 * `fechaEmisionDocSustento` (identifican el comprobante que se está
 * modificando), `valorModificacion` y `motivo`. No tiene `pagos` (el XSD de
 * notaCredito 1.1.0 no lo contempla).
 *
 * Nota: aunque `Detalle.codigoPrincipal`/`codigoAuxiliar` se reutiliza tal
 * cual, `NotaCreditoXmlSerializer::detalles()` los renombra en el XML a
 * `codigoInterno`/`codigoAdicional` — ese remapeo es responsabilidad del
 * serializador (Task 7), no de este tipo.
 */
export interface NotaCredito {
  tipo: TipoComprobante.NotaCredito;
  infoTributaria: InfoTributaria;
  fechaEmision: string;
  dirEstablecimiento?: string;
  tipoIdentificacionComprador: string;
  razonSocialComprador: string;
  identificacionComprador: string;
  contribuyenteEspecial?: string;
  obligadoContabilidad?: 'SI' | 'NO';
  rise?: string;
  codDocModificado: string;
  numDocModificado: string;
  fechaEmisionDocSustento: string;
  totalSinImpuestos: string;
  valorModificacion: string;
  moneda?: string;
  totalConImpuestos: TotalImpuesto[];
  detalles: Detalle[];
  motivo: string;
  infoAdicional?: Record<string, string>;
}
