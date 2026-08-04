import { TipoComprobante } from '../catalogs/index.js';
import type { InfoTributaria } from './shared.js';

/**
 * Fila de `impuestosDocSustento` dentro de un `docSustento` (port de
 * `DocSustento::$impuestosDocSustento`). El value object PHP la documenta
 * como `array<string,string>` cruda y `RetencionXmlSerializer::docsSustento()`
 * la serializa con un `foreach ($imp as $k => $v)` genérico — no hay una
 * clase `ImpuestoDocSustento` en PHP que fije el catálogo de campos. Los 7
 * campos conocidos aquí son exactamente los que usa el fixture de paridad
 * 1.x↔v2 (`tests/Unit/Xml/RetencionXmlSerializerTest.php::parityData()`,
 * replicado en `tests/Unit/Documents/RetencionTest.php`); el índice de
 * `string` permite pasar cualquier campo SRI adicional sin perder el
 * autocompletado/type-check de los campos ya conocidos por Task 6/8.
 */
export interface ImpuestoDocSustentoRow {
  codImpuestoDocSustento: string;
  codigoPorcentaje: string;
  baseImponible: string;
  tarifa: string;
  factorProporcionalidad: string;
  baseImponibleModificada: string;
  valorImpuesto: string;
  [extra: string]: string;
}

/**
 * Fila de `retenciones` dentro de un `docSustento` (port de
 * `DocSustento::$retenciones`). Mismos motivos que {@link ImpuestoDocSustentoRow}
 * para el índice de extras; los 5 campos conocidos son los que usan tanto
 * `RetencionXmlSerializerTest::parityData()` como el ejemplo de `README.md`
 * (`Procesar Comprobante de Retención`).
 */
export interface RetencionRow {
  codigo: string;
  codigoRetencion: string;
  baseImponible: string;
  porcentajeRetener: string;
  valorRetenido: string;
  [extra: string]: string;
}

/**
 * Fila de `pagos` dentro de un `docSustento` (port de `DocSustento::$pagos`).
 * `formaPago`/`total` son los únicos campos que aparecen en el fixture de
 * paridad — a diferencia del `Pago` compartido (nodo `pago` de
 * factura/notaDebito/liquidacionCompra), no hay evidencia en el código
 * fuente PHP de `plazo`/`unidadTiempo` para este nodo, así que no se
 * inventan; el índice de `string` cubre cualquier variante real del SRI.
 */
export interface PagoSustentoRow {
  formaPago: string;
  total: string;
  [extra: string]: string;
}

/**
 * Documento sustento de un Comprobante de Retención (port de
 * `src/Documents/DocSustento.php`, v2.0.0).
 *
 * `impuestosDocSustento`, `retenciones` y `pagos` usan filas
 * parcialmente tipadas ({@link ImpuestoDocSustentoRow}, {@link RetencionRow},
 * {@link PagoSustentoRow}): campos conocidos explícitos (los que Task 6 debe
 * leer y Task 8 debe escribir) + índice `[extra: string]: string` para
 * paridad exacta con el `foreach` genérico del value object/serializador PHP
 * sin perder cobertura de campos SRI no listados aquí. Las claves deben ser
 * nombres XML válidos (NCName).
 */
export interface DocSustento {
  codSustento: string;
  codDocSustento: string;
  numDocSustento: string;
  fechaEmisionDocSustento: string;
  totalSinImpuestos: string;
  importeTotal: string;
  impuestosDocSustento: ImpuestoDocSustentoRow[];
  retenciones: RetencionRow[];
  pagos: PagoSustentoRow[];
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
