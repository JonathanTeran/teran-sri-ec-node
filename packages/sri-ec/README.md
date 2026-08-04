# @amephia/sri-ec

Núcleo de la librería de Facturación Electrónica del SRI Ecuador para Node.js/TypeScript: documentos, validación (zod + `BusinessValidator`), serializadores XML, carga de certificados `.p12`, firma XAdES-BES, transporte SOAP (`fetch` nativo) y envío masivo (`BatchEmitter`). Agnóstico de framework — sin dependencia de NestJS ni de ningún otro.

Este paquete forma parte del monorepo [`teran-sri-ec-node`](../..). La documentación completa (instalación, ejemplos, tabla de comprobantes, flujo, troubleshooting) vive en el **[README de la raíz](../../README.md)**.

## Instalación

```bash
npm install @amephia/sri-ec
```

## Uso mínimo

```ts
import { Ambiente, loadCertificate, SriClient } from '@amephia/sri-ec';

const certificate = loadCertificate(p12Bytes, 'clave-del-p12');
const sri = new SriClient({ ambiente: Ambiente.Pruebas, certificate });

const resultado = await sri.emit(factura); // factura: Factura | LiquidacionCompra | NotaCredito | NotaDebito | GuiaRemision | Retencion
```

Ver el [README de la raíz](../../README.md) para la referencia completa de la API, el flujo de emisión, el módulo NestJS (`@amephia/nestjs-sri-ec`) y la sección de troubleshooting.

## Licencia

MIT — ver [LICENSE.md](../../LICENSE.md).
