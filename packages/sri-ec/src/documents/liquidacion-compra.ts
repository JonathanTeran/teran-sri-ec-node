import { TipoComprobante } from '../catalogs/index.js';
import type { Detalle, InfoTributaria, Pago, TotalImpuesto } from './shared.js';

/**
 * Liquidación de Compra (codDoc `03`). Port de
 * `src/Documents/LiquidacionCompra.php` + `src/Xml/LiquidacionCompraXmlSerializer.php`.
 *
 * Mismos totales que {@link import('./factura.js').Factura} pero con
 * "proveedor" en vez de "comprador" (el emisor liquida una compra a un
 * proveedor no obligado a facturar). `dirEstablecimiento`,
 * `contribuyenteEspecial` y `direccionProveedor` son opcionales porque el
 * serializador solo los emite si no son `null`
 * (`LiquidacionCompraXmlSerializer::infoLiquidacionCompra()`).
 */
export interface LiquidacionCompra {
  tipo: TipoComprobante.LiquidacionCompra;
  infoTributaria: InfoTributaria;
  fechaEmision: string;
  dirEstablecimiento?: string;
  contribuyenteEspecial?: string;
  tipoIdentificacionProveedor: string;
  razonSocialProveedor: string;
  identificacionProveedor: string;
  direccionProveedor?: string;
  totalSinImpuestos: string;
  totalDescuento: string;
  importeTotal: string;
  moneda?: string;
  obligadoContabilidad?: 'SI' | 'NO';
  totalConImpuestos: TotalImpuesto[];
  detalles: Detalle[];
  pagos: Pago[];
  infoAdicional?: Record<string, string>;
}
