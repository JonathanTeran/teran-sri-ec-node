import { TipoComprobante } from '../catalogs/index.js';
import type { Detalle, InfoTributaria, Pago, TotalImpuesto } from './shared.js';

/**
 * Factura (codDoc `01`). Port de `src/Documents/Factura.php` +
 * `src/Xml/FacturaXmlSerializer.php`.
 *
 * `direccionComprador`, `guiaRemision`, `propina`, `moneda` e
 * `infoAdicional` no existen en el value object v2 de PHP (que solo lanza
 * la excepción/serializa un subconjunto), pero sí son leídos por
 * `FacturaGenerator::createInfoFactura()` (1.x) — se incluyen aquí como
 * opcionales para no perder cobertura de campos que el XSD del SRI permite.
 *
 * `dirEstablecimiento`/`contribuyenteEspecial` (fix round 1, hallazgo
 * confirmado del reviewer — gap real, no del RIDE): `resources/xsd/factura_v2.1.0.xsd`
 * los declara `minOccurs="0"` en `infoFactura`, y
 * `FacturaGenerator::createInfoFactura()` (1.x) los escribe justo después de
 * `fechaEmision` cuando están presentes. `Factura` era el único de los 6
 * tipos de comprobante de este port que no los modelaba — los otros 5
 * (`LiquidacionCompra`, `NotaCredito`, `NotaDebito`, `GuiaRemision`,
 * `Retencion`) ya los traían opcionales.
 */
export interface Factura {
  tipo: TipoComprobante.Factura;
  infoTributaria: InfoTributaria;
  fechaEmision: string;
  dirEstablecimiento?: string;
  contribuyenteEspecial?: string;
  tipoIdentificacionComprador: string;
  razonSocialComprador: string;
  identificacionComprador: string;
  direccionComprador?: string;
  guiaRemision?: string;
  totalSinImpuestos: string;
  totalDescuento: string;
  propina?: string;
  importeTotal: string;
  moneda?: string;
  obligadoContabilidad?: 'SI' | 'NO';
  totalConImpuestos: TotalImpuesto[];
  detalles: Detalle[];
  pagos: Pago[];
  infoAdicional?: Record<string, string>;
}
