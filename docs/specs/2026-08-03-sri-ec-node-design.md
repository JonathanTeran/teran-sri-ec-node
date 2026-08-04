# Diseño: @amephia/sri-ec (Node.js/TypeScript) + @amephia/nestjs-sri-ec

**Fecha:** 2026-08-03
**Estado:** Aprobado por Jonathan Terán
**Origen:** Port del paquete PHP `amephia/sri-ec` v2.2.2 (API 2.0 tipada)

## Objetivo

Librería de Facturación Electrónica del SRI Ecuador para Node.js, con paridad
funcional completa con la API 2.0 del paquete PHP, más un módulo NestJS de
integración rápida.

## Decisiones tomadas

| Decisión | Elección |
|----------|----------|
| Forma | Core agnóstico (`@amephia/sri-ec`) + módulo Nest (`@amephia/nestjs-sri-ec`) |
| Alcance v1 | Paridad completa: 6 comprobantes, firma XAdES-BES, SOAP, batch, clave de acceso, RUC |
| API | Solo API tipada estilo v2 PHP. Sin API de arrays. Dominio en español |
| Validación | zod (rol del XSD) + BusinessValidator portado. Sin binarios nativos |
| Workspace | npm workspaces (pnpm no disponible en la máquina), TypeScript strict, Node ≥ 20 |
| Build | tsup, dual ESM + CJS, `.d.ts` incluidos |
| Tests | vitest |

## Estructura del monorepo

```
teran-sri-ec-node/
├── package.json             # workspaces raíz, scripts globales
├── tsconfig.base.json
├── docs/specs/
└── packages/
    ├── sri-ec/              # @amephia/sri-ec
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── sri-client.ts
    │   │   ├── catalogs/    # Ambiente, TipoComprobante, TipoEmision, FormaPago,
    │   │   │                #   catálogos SRI (identificación, retención, provincias…)
    │   │   ├── documents/   # Tipos TS: Factura, LiquidacionCompra, NotaCredito,
    │   │   │                #   NotaDebito, GuiaRemision, Retencion (+ sub-tipos)
    │   │   ├── schemas/     # zod por documento + business-validator.ts
    │   │   ├── xml/         # xml-builder.ts + 6 serializadores (port de src/Xml PHP)
    │   │   ├── signing/     # certificate.ts (loader node-forge), xades-signer.ts
    │   │   ├── transport/   # types.ts (SriTransport), soap-envelope.ts,
    │   │   │                #   soap-response-parser.ts, fetch-soap-transport.ts
    │   │   ├── emission/    # emission-result.ts, emission-status.ts, message.ts
    │   │   ├── batch/       # batch-emitter.ts, batch-processor.ts, retry-policy.ts,
    │   │   │                #   comprobante-repository.ts (interface + in-memory)
    │   │   ├── utils/       # clave-acceso.ts (módulo 11), ruc-validator.ts
    │   │   └── errors/      # SriError + ValidationError, SignatureError,
    │   │                    #   CertificateError, CommunicationError
    │   └── test/            # vitest + fixtures (XMLs golden del paquete PHP)
    └── nestjs-sri-ec/       # @amephia/nestjs-sri-ec
        └── src/
            ├── index.ts
            ├── sri.module.ts     # forRoot / forRootAsync
            ├── sri.service.ts    # inyectable, envuelve SriClient
            └── tokens.ts         # SRI_CLIENT, SRI_MODULE_OPTIONS
```

## Dependencias del core (todas JS puro, sin node-gyp)

- `node-forge` — parseo PKCS#12 incluidos certificados legacy RC2/3DES (elimina
  el problema OpenSSL 1.1 del mundo PHP).
- `@xmldom/xmldom` — DOM XML para construcción y firma.
- `fast-xml-parser` — parseo de respuestas SOAP.
- `zod` — validación estructural de documentos (rol del XSD).

`@amephia/nestjs-sri-ec`: peerDependencies `@nestjs/common` ^10 || ^11 y
`@amephia/sri-ec`.

## API pública del core

```ts
import { SriClient, Ambiente, loadCertificate, BatchEmitter } from '@amephia/sri-ec';
import type { Factura } from '@amephia/sri-ec';

const cert = loadCertificate(p12Buffer, 'clave');
const sri = new SriClient({ ambiente: Ambiente.Pruebas, certificate: cert });

const resultado = await sri.emit(factura);        // valida → firma → envía → autoriza
// resultado: EmissionResult
//   .status: 'AUTORIZADO' | 'RECHAZADO' | 'EN_PROCESO' | 'ERROR'
//   .claveAcceso .signedXml .numeroAutorizacion .fechaAutorizacion .authorizedXml
//   .messages: Message[]  .rejectionStage?: 'RECEPCION' | 'AUTORIZACION'

await sri.authorize(claveAcceso);                  // consulta de autorización
sri.sign(xml);                                     // solo firmar

const batch = new BatchEmitter({ ambiente: Ambiente.Pruebas });
batch.add(claveAcceso, signedXml);                 // idempotente por clave
await batch.run({ maxPasses: 20 });                // reanudable
batch.status();                                    // { AUTHORIZED: n, REJECTED: n, … }
batch.result(claveAcceso);                         // BatchItem | undefined
```

Detalles:

- `emit(documento, claveAcceso?)`: genera la clave si no se pasa (módulo 11).
- Documentos: objetos literales TS tipados; `sri.emit` valida con zod +
  BusinessValidator y lanza `ValidationError` con `errors: string[]`.
- Rechazo del SRI NO es excepción: es `EmissionResult` con status `RECHAZADO`.
- Transporte inyectable: `new SriClient({ …, transport: miTransporte })` con
  interface `SriTransport { recepcion(xml): …; autorizacion(clave): … }`.
- Timeouts y `AbortSignal` soportados en `FetchSoapTransport`.
- Clock inyectable (`Clock` interface) para testear `SigningTime` y fechas.

## Firma XAdES-BES

Port fiel de `XadesSigner.php` + `Certificate.php` + `CertificateLoader.php`:

- Estructura exacta que el SRI acepta: 3 References (comprobante,
  SignedProperties, Certificate), KeyInfo con X509 + RSAKeyValue/ECDSA,
  QualifyingProperties con SigningTime, CertDigest, IssuerSerial,
  DataObjectFormat con descripción configurable (`SignatureOptions`).
- C14N: canonicalización manual idéntica a la del PHP (el XML se construye de
  forma determinista, sin reordenamiento de atributos).
- RSA-SHA1/ECDSA según llave del certificado (mismo comportamiento que PHP).
- Cadena de confianza: se firma con el cert hoja; los intermedios de PKCS#12
  se ignoran igual que en PHP (comportamiento probado con Uanataca, Security
  Data, BCE, ANF, etc.).
- Golden files: XMLs firmados por el paquete PHP se usan como fixtures para
  validar estructura; verificación criptográfica round-trip con `node:crypto`.

## Transporte SOAP

Los dos servicios del SRI (RecepcionComprobantesOffline,
AutorizacionComprobantesOffline) son operaciones SOAP 1.1 simples:

- `SoapEnvelopeBuilder`: envelopes construidos como strings (idéntico enfoque
  a `SoapEnvelopeBuilder.php`).
- `SoapResponseParser`: port de `SoapResponseParser.php` con fast-xml-parser;
  desenvuelve `RespuestaRecepcionComprobante` / `RespuestaAutorizacionComprobante`
  (incluido el fix de bba035e/675ac68).
- `FetchSoapTransport`: `fetch` nativo, URLs por ambiente, timeout configurable.
- Estados: recepción `RECIBIDA`/`DEVUELTA`; autorización `AUTORIZADO`/
  `NO AUTORIZADO`/`EN PROCESO`/no encontrado.

## Validación

1. **zod** por documento: campos obligatorios, longitudes, formatos
   (`dd/MM/yyyy`, secuencial 9 dígitos, RUC 13, etc.), enums de catálogos.
   Réplica de las restricciones de los XSD oficiales.
2. **BusinessValidator** portado: cuadre de totales (base × tarifa = valor,
   suma de detalles = totalSinImpuestos, importeTotal, etc.), coherencia de
   fechas y documentos modificados.

## Módulo NestJS

```ts
SriModule.forRoot({ ambiente, certificate: { p12: Buffer, password: string } })
SriModule.forRootAsync({ inject: [ConfigService], useFactory: … })
```

- Global opcional (`isGlobal: true`).
- Provee `SriService` (métodos `emit`, `authorize`, `sign`, `createBatch`) y
  el token `SRI_CLIENT` para el cliente crudo.
- Cero lógica propia: solo DI y ciclo de vida.

## Errores

`SriError` (base, `code: string`) →
`ValidationError { code: 'VALIDATION', errors: string[] }`,
`CertificateError { code: 'CERTIFICATE' }`,
`SignatureError { code: 'SIGNATURE' }`,
`CommunicationError { code: 'COMMUNICATION' }`.

## Testing

- Unit: ClaveAcceso (módulo 11, casos conocidos del PHP), RucValidator,
  serializadores XML (comparación normalizada contra XMLs del paquete PHP),
  BusinessValidator, zod schemas.
- Firma: golden files + `crypto.verify` round-trip.
- Transporte: respuestas SOAP reales mockeadas (recepción OK/DEVUELTA,
  autorizado, rechazado, en proceso, clave no encontrada).
- Batch: reanudación, idempotencia, conteos.
- Smoke test manual: `examples/smoke-pruebas-sri.ts` contra ambiente de
  pruebas (equivalente al de PHP).

## Fuera de alcance v1

- Validación XSD nativa (libxml). Cubierta por zod + BusinessValidator.
- API de arrays estilo PHP 1.x.
- Generación de RIDE (PDF).
- Persistencia de batch fuera de memoria (la interface
  `ComprobanteRepository` queda pública para implementaciones propias).
