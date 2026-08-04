import { ValidationError } from '../errors/index.js';

/**
 * Constructor XML mínimo y determinista (port de `src/Xml/DomBuilder.php`).
 * A diferencia de PHP (que envuelve un `DOMDocument` real), aquí se modela
 * un árbol de elementos ligero en memoria y se serializa a texto a mano —
 * sin motor DOM — porque el único consumidor es el propio paquete (los
 * serializadores de comprobante), que solo construye el árbol una vez y lo
 * vuelca; no necesita parsear XML ni mutar un árbol ya serializado.
 *
 * Salida SIN pretty-print (sin indentación ni saltos de línea añadidos):
 * igual que `DomBuilder.php`, que solo crea elementos/texto — el
 * pretty-print de PHP lo añade `DOMDocument::$formatOutput = true` en
 * `FacturaXmlSerializer::serialize()`, una capa por encima de `DomBuilder`.
 * El test golden normaliza espacios en blanco entre etiquetas antes de
 * comparar (ver `test/xml-factura.test.ts`), así que la ausencia de
 * indentación aquí no rompe la paridad con el fixture generado por PHP.
 */
export class XmlElement {
  readonly attributes: Array<[name: string, value: string]> = [];
  readonly children: Array<XmlElement | string> = [];

  constructor(readonly name: string) {}

  setAttribute(name: string, value: string): this {
    this.attributes.push([name, value]);
    return this;
  }
}

export class XmlBuilder {
  /**
   * Crea un elemento `name` como hijo de `parent`, con texto opcional
   * `value` como único nodo hijo, y devuelve el elemento creado (para poder
   * anexarle hijos después). Port de `DomBuilder::child()`.
   *
   * - `value` omitido o `null` → elemento vacío intencional / contenedor al
   *   que se le anexarán hijos después (p.ej. `<pagos>`, `<totalConImpuestos>`).
   * - `value === ''` → error: usar `null`/omitir para un elemento vacío
   *   intencional, u omitir la llamada entera si el elemento es opcional.
   */
  child(parent: XmlElement, name: string, value?: string | null): XmlElement {
    if (value === '') {
      throw new ValidationError(
        `XmlBuilder::child(): cadena vacía para el elemento '${name}'.`,
        [
          "Use null/omita el valor para un elemento vacío intencional, u omita la llamada a child() si el elemento es opcional.",
        ],
      );
    }
    const el = new XmlElement(name);
    if (value !== undefined && value !== null) {
      el.children.push(value);
    }
    parent.children.push(el);
    return el;
  }
}

/** Escapa `& < > " '` para uso seguro dentro de texto o valores de atributo XML. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Serializa el árbol a partir de `root` como documento XML completo
 * (prólogo `<?xml version="1.0" encoding="UTF-8"?>` + elemento raíz), sin
 * pretty-print. Determinista: mismo árbol de entrada produce siempre el
 * mismo string de salida (mismo orden de atributos/hijos que fueron
 * anexados, sin reordenamiento).
 */
export function serializeXmlDocument(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${renderElement(root)}`;
}

function renderElement(el: XmlElement): string {
  const attrs = el.attributes
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('');

  if (el.children.length === 0) {
    return `<${el.name}${attrs}/>`;
  }

  const inner = el.children
    .map((child) => (typeof child === 'string' ? escapeXml(child) : renderElement(child)))
    .join('');

  return `<${el.name}${attrs}>${inner}</${el.name}>`;
}
