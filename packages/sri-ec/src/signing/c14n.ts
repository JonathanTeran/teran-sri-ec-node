import { DOMParser } from '@xmldom/xmldom';
import type { Attr, Document, Element, Node, ProcessingInstruction } from '@xmldom/xmldom';

import { SignatureError } from '../errors/index.js';

/**
 * Canonicalización XML (C14N 1.0 *inclusiva*, sin comentarios) y serialización
 * estilo libxml, escritas a mano para reproducir EXACTAMENTE lo que hace el
 * firmador PHP, que se apoya en `DOMDocument`/libxml:
 *
 *  - `DOMNode::C14N()` sin argumentos = C14N 1.0 inclusiva y SIN comentarios
 *    (`http://www.w3.org/TR/2001/REC-xml-c14n-20010315`, el algoritmo que la
 *    firma declara en `ds:CanonicalizationMethod`). "Inclusiva" es clave: al
 *    canonicalizar un SUBÁRBOL (p. ej. `ds:SignedInfo`) se arrastran TODAS las
 *    declaraciones de espacio de nombres en ámbito heredadas de los ancestros
 *    — por eso el SignedInfo firmado incluye `xmlns:ds` y `xmlns:etsi` aunque
 *    ninguno de los dos esté declarado en él.
 *  - `DOMDocument::$preserveWhiteSpace = false` (libxml `xmlKeepBlanks(0)`)
 *    descarta los nodos de texto en blanco "ignorables" ANTES de calcular el
 *    digest del comprobante: sin esta poda el digest no coincide con el de PHP
 *    para un XML indentado. Ver `stripIgnorableWhitespace()`.
 *  - `DOMDocument::saveXML(null, LIBXML_NOEMPTYTAG)` serializa `<a></a>` en vez
 *    de `<a/>` (el SRI lo exige) y cierra el documento con un salto de línea.
 *
 * No se usa el serializador de `@xmldom/xmldom` en ningún punto: xmldom
 * auto-cierra elementos vacíos y escapa distinto. xmldom solo actúa como
 * PARSER y como estructura de árbol mutable.
 */

const XMLNS_URI = 'http://www.w3.org/2000/xmlns/';
const XML_URI = 'http://www.w3.org/XML/1998/namespace';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;

/**
 * Parsea el XML a un DOM mutable. Cualquier error fatal del parser se traduce
 * a `SignatureError` con el mismo mensaje que da el PHP
 * (`XadesSigner::sign()` lanza `SignatureException` si `loadXML` falla).
 */
export function parseXml(xml: string): Document {
  let doc: Document;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        if (level === 'fatalError' || level === 'error') {
          throw new Error(message);
        }
      },
    }).parseFromString(xml, 'text/xml');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SignatureError(
      `Error al cargar el XML para la firma. Verifique que sea XML válido. (${detail})`,
    );
  }

  if (!doc.documentElement) {
    throw new SignatureError('El XML no tiene elemento raíz.');
  }

  return doc;
}

/**
 * Poda los nodos de texto en blanco "ignorables", replicando la heurística
 * `areBlanks()` de libxml que activa `preserveWhiteSpace = false`:
 *
 *  - solo texto compuesto íntegramente por espacios/tabs/saltos de línea;
 *  - solo si el elemento padre tiene al menos un hijo ELEMENTO (un
 *    `<a>   </a>` conserva su contenido, igual que en libxml);
 *  - nunca en contenido mixto (si el padre ya tiene texto con contenido real);
 *  - nunca bajo `xml:space="preserve"`;
 *  - nunca secciones CDATA (libxml jamás las considera "blancos").
 */
export function stripIgnorableWhitespace(node: Document | Element, preserve = false): void {
  const children = childNodes(node);

  let preserveHere = preserve;
  if (node.nodeType === ELEMENT_NODE) {
    const space = (node as Element).getAttribute('xml:space');
    if (space === 'preserve') {
      preserveHere = true;
    } else if (space === 'default') {
      preserveHere = false;
    }
  }

  const hasElementChild = children.some((child) => child.nodeType === ELEMENT_NODE);
  const hasRealText = children.some(
    (child) =>
      (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) &&
      !isWhitespace(child.nodeValue ?? ''),
  );

  if (!preserveHere && hasElementChild && !hasRealText) {
    for (const child of children) {
      if (child.nodeType === TEXT_NODE && isWhitespace(child.nodeValue ?? '')) {
        node.removeChild(child);
      }
    }
  }

  for (const child of children) {
    if (child.nodeType === ELEMENT_NODE) {
      stripIgnorableWhitespace(child as Element, preserveHere);
    }
  }
}

/**
 * C14N 1.0 inclusiva sin comentarios de un documento o de un subárbol.
 * Equivalente a `DOMNode::C14N()` en PHP.
 */
export function canonicalize(node: Document | Element): string {
  const parts: string[] = [];

  if (node.nodeType === DOCUMENT_NODE) {
    // El node-set de un documento contiene el elemento raíz y las PIs de nivel
    // documento; el prólogo (`<?xml ... ?>`, que xmldom expone como PI con
    // target "xml") y los comentarios quedan fuera.
    let afterRoot = false;
    for (const child of childNodes(node)) {
      if (child.nodeType === ELEMENT_NODE) {
        renderElement(child as Element, inScopeNamespacesOf(child as Element), new Map(), parts);
        afterRoot = true;
      } else if (child.nodeType === PROCESSING_INSTRUCTION_NODE) {
        const pi = child as ProcessingInstruction;
        if (pi.target === 'xml') {
          continue;
        }
        parts.push(afterRoot ? `\n${renderPi(pi)}` : `${renderPi(pi)}\n`);
      }
    }
    return parts.join('');
  }

  if (node.nodeType === ELEMENT_NODE) {
    const element = node as Element;
    renderElement(element, inScopeNamespacesOf(element), new Map(), parts);
    return parts.join('');
  }

  throw new SignatureError('Solo se puede canonicalizar un documento o un elemento.');
}

/**
 * Serializa el documento como lo hace `DOMDocument::saveXML(null, LIBXML_NOEMPTYTAG)`:
 * prólogo + árbol sin auto-cierre de elementos vacíos + salto de línea final.
 * Los atributos salen en el ORDEN DEL DOCUMENTO (no ordenados como en C14N).
 */
export function serializeDocument(doc: Document): string {
  const parts: string[] = [xmlDeclaration(doc), '\n'];

  for (const child of childNodes(doc)) {
    if (child.nodeType === PROCESSING_INSTRUCTION_NODE) {
      if ((child as ProcessingInstruction).target === 'xml') {
        continue;
      }
      parts.push(renderPi(child as ProcessingInstruction), '\n');
    } else if (child.nodeType === COMMENT_NODE) {
      parts.push(`<!--${child.nodeValue ?? ''}-->`, '\n');
    } else if (child.nodeType === ELEMENT_NODE) {
      parts.push(serializeNode(child), '\n');
    }
    // El texto de nivel documento no existe en libxml: se ignora.
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// C14N
// ---------------------------------------------------------------------------

function renderElement(
  element: Element,
  inScope: Map<string, string>,
  rendered: Map<string, string>,
  parts: string[],
): void {
  const declarations: Array<[prefix: string, uri: string]> = [];
  for (const [prefix, uri] of inScope) {
    if (rendered.get(prefix) === uri) {
      continue;
    }
    // Una `xmlns=""` solo se emite si hace falta para ANULAR un espacio de
    // nombres por defecto ya emitido por un ancestro.
    if (prefix === '' && uri === '' && (rendered.get('') ?? '') === '') {
      continue;
    }
    declarations.push([prefix, uri]);
  }
  declarations.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : compareStrings(a, b)));

  const attributes = attrNodes(element)
    .filter((attr) => !isNamespaceDeclaration(attr))
    .map((attr) => ({ attr, uri: attributeNamespace(attr, inScope) }))
    .sort(
      (a, b) =>
        compareStrings(a.uri, b.uri) || compareStrings(localName(a.attr), localName(b.attr)),
    );

  parts.push(`<${element.nodeName}`);
  for (const [prefix, uri] of declarations) {
    parts.push(` ${prefix === '' ? 'xmlns' : `xmlns:${prefix}`}="${escapeC14nAttribute(uri)}"`);
  }
  for (const { attr } of attributes) {
    parts.push(` ${attr.nodeName}="${escapeC14nAttribute(attr.value ?? '')}"`);
  }
  parts.push('>');

  const renderedHere = new Map(rendered);
  for (const [prefix, uri] of declarations) {
    renderedHere.set(prefix, uri);
  }

  for (const child of childNodes(element)) {
    switch (child.nodeType) {
      case ELEMENT_NODE: {
        const childElement = child as Element;
        const childScope = new Map(inScope);
        mergeNamespaceDeclarations(childElement, childScope);
        renderElement(childElement, childScope, renderedHere, parts);
        break;
      }
      case TEXT_NODE:
      case CDATA_SECTION_NODE:
        // C14N convierte CDATA en texto escapado.
        parts.push(escapeC14nText(child.nodeValue ?? ''));
        break;
      case PROCESSING_INSTRUCTION_NODE:
        parts.push(renderPi(child as ProcessingInstruction));
        break;
      default:
        // Los comentarios quedan fuera (C14N "sin comentarios").
        break;
    }
  }

  parts.push(`</${element.nodeName}>`);
}

/** Declaraciones xmlns en ámbito para `element`, incluyendo las de sus ancestros. */
function inScopeNamespacesOf(element: Element): Map<string, string> {
  const chain: Element[] = [];
  let current: Node | null = element;
  while (current && current.nodeType === ELEMENT_NODE) {
    chain.push(current as Element);
    current = current.parentNode;
  }

  const map = new Map<string, string>();
  for (let i = chain.length - 1; i >= 0; i--) {
    mergeNamespaceDeclarations(chain[i]!, map);
  }
  return map;
}

function mergeNamespaceDeclarations(element: Element, map: Map<string, string>): void {
  for (const attr of attrNodes(element)) {
    if (attr.nodeName === 'xmlns') {
      map.set('', attr.value ?? '');
    } else if (attr.nodeName.startsWith('xmlns:')) {
      map.set(attr.nodeName.slice('xmlns:'.length), attr.value ?? '');
    }
  }
}

function isNamespaceDeclaration(attr: Attr): boolean {
  return (
    attr.nodeName === 'xmlns' ||
    attr.nodeName.startsWith('xmlns:') ||
    attr.namespaceURI === XMLNS_URI
  );
}

function attributeNamespace(attr: Attr, inScope: Map<string, string>): string {
  const colon = attr.nodeName.indexOf(':');
  if (colon < 0) {
    // Un atributo sin prefijo NUNCA está en un espacio de nombres.
    return '';
  }
  const prefix = attr.nodeName.slice(0, colon);
  if (prefix === 'xml') {
    return XML_URI;
  }
  return inScope.get(prefix) ?? attr.namespaceURI ?? '';
}

function localName(attr: Attr): string {
  const colon = attr.nodeName.indexOf(':');
  return colon < 0 ? attr.nodeName : attr.nodeName.slice(colon + 1);
}

/** Orden por unidades de código UTF-16, que es el que exige C14N. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapeC14nText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;');
}

function escapeC14nAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

// ---------------------------------------------------------------------------
// Serialización estilo libxml
// ---------------------------------------------------------------------------

function serializeNode(node: Node): string {
  switch (node.nodeType) {
    case ELEMENT_NODE: {
      const element = node as Element;
      let out = `<${element.nodeName}`;
      for (const attr of attrNodes(element)) {
        out += ` ${attr.nodeName}="${escapeLibxmlAttribute(attr.value ?? '')}"`;
      }
      // LIBXML_NOEMPTYTAG: nunca `<a/>`, siempre `<a></a>` (requisito del SRI).
      out += '>';
      for (const child of childNodes(element)) {
        out += serializeNode(child);
      }
      return `${out}</${element.nodeName}>`;
    }
    case TEXT_NODE:
      return escapeLibxmlText(node.nodeValue ?? '');
    case CDATA_SECTION_NODE:
      return `<![CDATA[${node.nodeValue ?? ''}]]>`;
    case COMMENT_NODE:
      return `<!--${node.nodeValue ?? ''}-->`;
    case PROCESSING_INSTRUCTION_NODE:
      return renderPi(node as ProcessingInstruction);
    default:
      return '';
  }
}

function escapeLibxmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

function escapeLibxmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/**
 * Reconstruye el prólogo tal como lo emitiría libxml a partir de la versión y
 * la codificación que el parser leyó del documento.
 */
function xmlDeclaration(doc: Document): string {
  const declaration = childNodes(doc).find(
    (child) =>
      child.nodeType === PROCESSING_INSTRUCTION_NODE &&
      (child as ProcessingInstruction).target === 'xml',
  );
  const data = declaration ? ((declaration as ProcessingInstruction).data ?? '') : '';

  const version = /version\s*=\s*["']([^"']*)["']/.exec(data)?.[1] ?? '1.0';
  const encoding = /encoding\s*=\s*["']([^"']*)["']/.exec(data)?.[1];
  const standalone = /standalone\s*=\s*["']([^"']*)["']/.exec(data)?.[1];

  let out = `<?xml version="${version}"`;
  if (encoding !== undefined && encoding !== '') {
    out += ` encoding="${encoding}"`;
  }
  if (standalone === 'yes' || standalone === 'no') {
    out += ` standalone="${standalone}"`;
  }
  return `${out}?>`;
}

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------

function renderPi(pi: ProcessingInstruction): string {
  const data = pi.data ?? '';
  return data === '' ? `<?${pi.target}?>` : `<?${pi.target} ${data}?>`;
}

/** `childNodes` como array (una NodeList viva se rompe al mutar el árbol). */
function childNodes(node: Node): Node[] {
  const list = node.childNodes;
  const out: Node[] = [];
  for (let i = 0; i < list.length; i++) {
    const child = list.item(i);
    if (child) {
      out.push(child);
    }
  }
  return out;
}

function attrNodes(element: Element): Attr[] {
  const list = element.attributes;
  const out: Attr[] = [];
  for (let i = 0; i < list.length; i++) {
    const attr = list.item(i);
    if (attr) {
      out.push(attr);
    }
  }
  return out;
}

function isWhitespace(value: string): boolean {
  return /^[\t\n\r ]*$/.test(value);
}
