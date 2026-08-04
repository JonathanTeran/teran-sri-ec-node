import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { Message } from '../emission/index.js';
import { CommunicationError } from '../errors/index.js';
import type { AuthorizationOutcome, ReceptionOutcome } from './types.js';

/**
 * Parser namespace-agnóstico (por local-name, como `local-name()` en XPath)
 * de las respuestas SOAP del SRI offline. Port de
 * `Teran\Sri\Transport\SoapResponseParser`, que usa `DOMXPath` con
 * `//*[local-name()="..."]` en vez de rutas fijas — precisamente lo que
 * permite que `parseAuthorization()` encuentre `<autorizacion>` sin importar
 * si el SRI la envuelve en `<RespuestaAutorizacionComprobante>` o no (el bug
 * de la commit 675ac68 solo afectaba al parser basado en `stdClass` de
 * `ext-soap`, que navegaba por ruta fija; este parser, por búsqueda a
 * cualquier profundidad, nunca tuvo ese problema — y este port preserva esa
 * propiedad en vez de reintroducirla).
 *
 * `fast-xml-parser` con `removeNSPrefix: true` reproduce `local-name()`
 * (`ns2:autorizacionComprobanteResponse` → `autorizacionComprobanteResponse`).
 * `parseTagValue: false` es OBLIGATORIO: sin él, valores puramente numéricos
 * como `numeroAutorizacion` o `claveAcceso` (cadenas de 30+ dígitos) se
 * parsean como `number` de JS y pierden precisión (notación científica) —
 * el equivalente TS del `(string)` cast explícito que hace el PHP en cada
 * campo.
 */
const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
});

/** Árbol resultante de `fast-xml-parser` con las opciones de arriba: hoja de texto, elemento (mapa nombre→hijo) o lista de elementos repetidos con el mismo nombre. */
type XNode = string | XElement | XNode[];
type XElement = { [tag: string]: XNode };

export function parseReception(responseXml: string): ReceptionOutcome {
  const root = parseXml(responseXml);
  throwOnFault(root);

  const estado = textValue(findFirst(root, 'estado')) ?? 'DEVUELTA';
  const mensajes = findAll(root, 'mensajes').flatMap((m) => directChildren(m, 'mensaje').map(toMessage));

  return { estado, mensajes };
}

export function parseAuthorization(responseXml: string): AuthorizationOutcome {
  const root = parseXml(responseXml);
  throwOnFault(root);

  const auth = findFirst(root, 'autorizacion');
  if (typeof auth !== 'object' || Array.isArray(auth)) {
    // Sin nodo <autorizacion>: recién RECIBIDA (aún no procesada) o
    // numeroComprobantes=0 (clave no encontrada) — ambos casos son
    // indistinguibles desde este XML únicamente por su forma, así que se
    // reportan de manera uniforme como 'EN PROCESO' (reintentable), nunca
    // como un rechazo terminal. Port de
    // `SoapResponseParser::parseAuthorization()` (ver commit 4b9a0be).
    return { estado: 'EN PROCESO', mensajes: [] };
  }

  const mensajes = directChildren(auth['mensajes'], 'mensaje').map(toMessage);

  return {
    estado: textValue(auth['estado']) ?? 'EN PROCESO',
    numeroAutorizacion: textValue(auth['numeroAutorizacion']),
    fechaAutorizacion: textValue(auth['fechaAutorizacion']),
    comprobante: textValue(auth['comprobante']),
    mensajes,
  };
}

function parseXml(xml: string): XElement {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new CommunicationError(
      `Respuesta XML del SRI malformada: ${validation.err.msg} (línea ${validation.err.line}, columna ${validation.err.col})`,
    );
  }
  return parser.parse(xml) as XElement;
}

function throwOnFault(root: XElement): void {
  const fault = findFirst(root, 'Fault');
  if (fault === undefined) {
    return;
  }
  const faultstring =
    typeof fault === 'object' && !Array.isArray(fault)
      ? textValue(findFirst(fault, 'faultstring'))
      : undefined;
  throw new CommunicationError(`SRI SOAP Fault: ${faultstring ?? 'unknown SOAP fault'}`);
}

/**
 * Busca el primer descendiente (en cualquier profundidad, preorder — el
 * equivalente de `//*[local-name()="tagName"]` seguido de `.item(0)`)
 * etiquetado `tagName` y devuelve su valor. Si hay varios elementos hermanos
 * con ese mismo nombre en la misma posición (`fast-xml-parser` los agrupa en
 * un array), se toma el primero — igual que `item(0)` en orden de documento.
 */
function findFirst(node: XNode, tagName: string): XNode | undefined {
  if (typeof node !== 'object') {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirst(item, tagName);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === tagName) {
      return Array.isArray(value) ? value[0] : value;
    }
    const found = findFirst(value, tagName);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Busca TODOS los descendientes (a cualquier profundidad) etiquetados
 * `tagName`, aplanando los que ya vinieran agrupados en array. Equivalente a
 * `//*[local-name()="tagName"]` (sin `.item(0)`) — usado para el `mensajes`
 * de recepción, que en el PHP original también se busca globalmente en todo
 * el documento (no acotado a un `<comprobante>` específico).
 */
function findAll(node: XNode, tagName: string): XElement[] {
  const out: XElement[] = [];
  collect(node);
  return out;

  function collect(current: XNode): void {
    if (typeof current !== 'object') {
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        collect(item);
      }
      return;
    }
    for (const [key, value] of Object.entries(current)) {
      if (key === tagName) {
        if (Array.isArray(value)) {
          out.push(...value.filter(isElement));
        } else if (isElement(value)) {
          out.push(value);
        }
      }
      collect(value);
    }
  }
}

/**
 * Hijos DIRECTOS de `node` etiquetados `childTag` (nunca busca en
 * profundidad). Equivalente a `childText()`/`*[local-name()="mensaje"]`
 * relativo en el PHP original: crítico para no confundir el elemento
 * `<mensaje>` (repetible, contenedor) con el campo de texto `<mensaje>` que
 * ese mismo elemento tiene adentro (mismo nombre de tag en dos niveles
 * distintos de la respuesta del SRI).
 *
 * Normaliza aquí mismo el "single-element pitfall" de `fast-xml-parser`: un
 * único `<mensaje>` se parsea como objeto suelto, dos o más como array —
 * `Array.isArray(raw) ? raw : [raw]` cubre ambos casos con el mismo código.
 */
function directChildren(node: XNode | undefined, childTag: string): XElement[] {
  if (typeof node !== 'object' || Array.isArray(node)) {
    return [];
  }
  const raw = node[childTag];
  if (raw === undefined) {
    return [];
  }
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.filter(isElement);
}

function isElement(node: XNode): node is XElement {
  return typeof node === 'object' && !Array.isArray(node);
}

/**
 * Extrae el texto de una hoja. Una cadena vacía (elemento presente pero sin
 * contenido, p.ej. `<numeroAutorizacion/>`) se normaliza a `undefined` —
 * igual que `childText()` en PHP (`$v === '' ? null : $v`).
 */
function textValue(node: XNode | undefined): string | undefined {
  if (typeof node !== 'string' || node === '') {
    return undefined;
  }
  return node;
}

function toMessage(el: XElement): Message {
  return {
    identificador: textValue(el['identificador']) ?? '',
    mensaje: textValue(el['mensaje']) ?? '',
    tipo: textValue(el['tipo']) ?? '',
    informacionAdicional: textValue(el['informacionAdicional']) ?? '',
  };
}
