/**
 * Catálogos SRI 2.0 (port de `src/Catalogs2/*.php`). Los valores del enum
 * son exactamente los códigos que el SRI espera en el XML — no renombrar.
 */

/** Ambiente de emisión: 1 = Pruebas, 2 = Producción. */
export enum Ambiente {
  Pruebas = '1',
  Produccion = '2',
}

/** Tipo de comprobante electrónico (campo `codDoc` en la clave de acceso). */
export enum TipoComprobante {
  Factura = '01',
  LiquidacionCompra = '03',
  NotaCredito = '04',
  NotaDebito = '05',
  GuiaRemision = '06',
  Retencion = '07',
}

/**
 * Tipo de emisión. Solo existe `Normal` — el tipo `Indisponibilidad` (offline
 * contingencia) fue retirado del catálogo SRI y no se soporta.
 */
export enum TipoEmision {
  Normal = '1',
}
