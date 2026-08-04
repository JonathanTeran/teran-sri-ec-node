import { TipoComprobante } from '../catalogs/index.js';
import type { InfoTributaria, Pago, TotalImpuesto } from './shared.js';

/**
 * Un motivo de la Nota de Débito (port de `src/Documents/Motivo.php`). Solo
 * lo usa este comprobante, por eso vive aquí y no en `shared.ts`.
 */
export interface Motivo {
  razon: string;
  valor: string;
}

/**
 * Nota de Débito (codDoc `05`). Port de `src/Documents/NotaDebito.php` +
 * `src/Xml/NotaDebitoXmlSerializer.php`.
 *
 * `impuestos` usa {@link TotalImpuesto} (no `Impuesto`) porque
 * `NotaDebitoXmlSerializer::infoNotaDebito()` nunca escribe `tarifa` para
 * este nodo — solo `codigo`, `codigoPorcentaje`, `baseImponible`, `valor`.
 * `motivos` es obligatorio y no vacío en el value object PHP.
 */
export interface NotaDebito {
  tipo: TipoComprobante.NotaDebito;
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
  impuestos: TotalImpuesto[];
  valorTotal: string;
  pagos: Pago[];
  motivos: Motivo[];
  infoAdicional?: Record<string, string>;
}
