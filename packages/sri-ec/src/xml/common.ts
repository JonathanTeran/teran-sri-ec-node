import { TipoEmision } from '../catalogs/index.js';
import type { InfoTributaria } from '../documents/index.js';
import { XmlBuilder, XmlElement } from './xml-builder.js';

/**
 * Escribe el nodo `<infoTributaria>`, común a los 6 comprobantes
 * electrónicos: mismo complexType XSD `infoTributaria` en los esquemas
 * oficiales del SRI — confirmado byte a byte entre `factura_v2.1.0.xsd` y
 * `liquidacionCompra_v1.1.0.xsd` (los dos únicos XSD disponibles en el repo
 * PHP hermano `teran-sri-ec`). Port de la lógica ya usada en
 * `FacturaXmlSerializer.infoTributaria()` (Task 7), extraída aquí para que
 * los 5 serializadores de Task 8 no la dupliquen 5 veces.
 *
 * Orden XSD: `ambiente` → `tipoEmision` → `razonSocial` →
 * `nombreComercial`? → `ruc` → `claveAcceso` → `codDoc` → `estab` →
 * `ptoEmi` → `secuencial` → `dirMatriz` → `agenteRetencion`? →
 * `contribuyenteRimpe`?.
 *
 * `agenteRetencion`/`contribuyenteRimpe` NO existen en el value object v2 de
 * PHP (`Documents\InfoTributaria`, ningún comprobante lo modela), pero SÍ
 * son legales en el XSD oficial (`minOccurs="0"`) y el generador 1.x
 * (`XmlGenerator::createInfoTributaria()`) los escribe cuando están
 * presentes — se emiten aquí cuando el documento TS los trae, igual que
 * `FacturaXmlSerializer` (Task 7).
 */
export function writeInfoTributaria(
  b: XmlBuilder,
  root: XmlElement,
  info: InfoTributaria,
  claveAcceso: string,
  codDoc: string,
): void {
  const node = b.child(root, 'infoTributaria');
  b.child(node, 'ambiente', info.ambiente);
  b.child(node, 'tipoEmision', info.tipoEmision ?? TipoEmision.Normal);
  b.child(node, 'razonSocial', info.razonSocial);
  if (info.nombreComercial !== undefined) {
    b.child(node, 'nombreComercial', info.nombreComercial);
  }
  b.child(node, 'ruc', info.ruc);
  b.child(node, 'claveAcceso', claveAcceso);
  b.child(node, 'codDoc', codDoc);
  b.child(node, 'estab', info.estab);
  b.child(node, 'ptoEmi', info.ptoEmi);
  b.child(node, 'secuencial', info.secuencial);
  b.child(node, 'dirMatriz', info.dirMatriz);
  if (info.agenteRetencion !== undefined) {
    b.child(node, 'agenteRetencion', info.agenteRetencion);
  }
  if (info.contribuyenteRimpe !== undefined) {
    b.child(node, 'contribuyenteRimpe', info.contribuyenteRimpe);
  }
}

/**
 * Escribe `<infoAdicional>` (con sus `campoAdicional[nombre]`), como último
 * hijo del elemento raíz, si `infoAdicional` trae al menos una entrada — port
 * de `XmlGenerator::addInfoAdicional()` (1.x), reusado por los 5
 * serializadores de Task 8 igual que
 * `FacturaXmlSerializer.infoAdicional()` (Task 7, no extraído allí pero con
 * idéntico comportamiento).
 *
 * Ninguno de los 5 value objects v2 de PHP (`LiquidacionCompra`,
 * `NotaCredito`, `NotaDebito`, `GuiaRemision`, `Retencion`) modela
 * `infoAdicional`, así que ninguno de los 5 `Xml*Serializer.php`
 * correspondientes lo serializa — pero el generador 1.x SÍ (paso 4 de cada
 * `*Generator::generate()`), y el tipo TS del documento sí lo modela
 * (`infoAdicional?: Record<string, string>`), así que se emite aquí cuando
 * está presente.
 */
export function writeInfoAdicional(
  b: XmlBuilder,
  root: XmlElement,
  infoAdicional?: Record<string, string>,
): void {
  const entries = infoAdicional ? Object.entries(infoAdicional) : [];
  if (entries.length === 0) {
    return;
  }

  const node = b.child(root, 'infoAdicional');
  for (const [nombre, valor] of entries) {
    const campo = b.child(node, 'campoAdicional', valor);
    campo.setAttribute('nombre', nombre);
  }
}
