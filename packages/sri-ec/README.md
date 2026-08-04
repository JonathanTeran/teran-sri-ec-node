# sri-ec

[![npm version](https://img.shields.io/npm/v/sri-ec.svg?style=flat-square)](https://www.npmjs.com/package/sri-ec) [![Licencia MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](https://github.com/JonathanTeran/teran-sri-ec-node/blob/main/LICENSE.md) [![Node.js](https://img.shields.io/badge/node-%3E%3D%2020-339933.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

Librería de **Facturación Electrónica del SRI Ecuador** para Node.js/TypeScript: documentos tipados, validación (zod + `BusinessValidator`), serialización XML, carga de certificados `.p12`, firma **XAdES-BES**, transporte SOAP sobre `fetch` nativo y envío masivo (`BatchEmitter`). Agnóstico de framework y sin dependencias nativas (nada de `node-gyp`).

Es el port oficial de [`amephia/sri-ec`](https://packagist.org/packages/amephia/sri-ec) (PHP): misma firma XAdES-BES, verificada byte a byte contra el paquete original.

- 📖 **Documentación completa:** <https://github.com/JonathanTeran/teran-sri-ec-node>
- 🐛 **Reportar un problema:** <https://github.com/JonathanTeran/teran-sri-ec-node/issues>

## Características

- Los **6 comprobantes electrónicos**: Factura (`01`), Liquidación de Compra (`03`), Nota de Crédito (`04`), Nota de Débito (`05`), Guía de Remisión (`06`) y Comprobante de Retención (`07`).
- Certificados `.p12`/`.pfx` **modernos y legacy** (RC2/3DES pre-2024), sin depender de la versión de OpenSSL del sistema.
- Firma **RSA y ECDSA**, digest configurable (`sha1` por defecto — lo que el SRI valida hoy — o `sha256`).
- Validación **estructural** (zod) y **de negocio** (coherencia aritmética de totales, impuestos y retenciones).
- **Dual ESM + CommonJS** con tipos incluidos (`.d.ts` / `.d.cts`).

## Instalación

```bash
npm install sri-ec
```

Requiere **Node.js >= 20**.

## Uso

```ts
import { readFileSync } from 'node:fs';
import {
  Ambiente,
  FormaPago,
  loadCertificate,
  SriClient,
  TipoComprobante,
  TipoEmision,
  type Factura,
} from 'sri-ec';

const certificate = loadCertificate(readFileSync('firma.p12'), process.env['SRI_P12_PASSWORD']!);
const sri = new SriClient({ ambiente: Ambiente.Pruebas, certificate });

const factura: Factura = {
  tipo: TipoComprobante.Factura,
  infoTributaria: {
    ambiente: Ambiente.Pruebas,
    razonSocial: 'MI EMPRESA S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000001',
    dirMatriz: 'Quito, Ecuador',
    tipoEmision: TipoEmision.Normal,
  },
  fechaEmision: '26/01/2026',
  tipoIdentificacionComprador: '05',
  razonSocialComprador: 'CLIENTE FINAL',
  identificacionComprador: '9999999999',
  totalSinImpuestos: '100.00',
  totalDescuento: '0.00',
  importeTotal: '112.00',
  totalConImpuestos: [
    { codigo: '2', codigoPorcentaje: '2', baseImponible: '100.00', valor: '12.00' },
  ],
  detalles: [
    {
      codigoPrincipal: 'PROD001',
      descripcion: 'Producto de prueba',
      cantidad: '1.00',
      precioUnitario: '100.00',
      descuento: '0.00',
      precioTotalSinImpuesto: '100.00',
      impuestos: [
        { codigo: '2', codigoPorcentaje: '2', tarifa: '12.00', baseImponible: '100.00', valor: '12.00' },
      ],
    },
  ],
  pagos: [{ formaPago: FormaPago.EFECTIVO, total: '112.00' }],
};

const resultado = await sri.emit(factura);

console.log(resultado.status); // 'AUTORIZADO' | 'RECHAZADO' | 'EN_PROCESO'
if (resultado.status === 'AUTORIZADO') {
  console.log(resultado.numeroAutorizacion, resultado.fechaAutorizacion);
} else {
  for (const m of resultado.messages) console.log(`[${m.identificador}] ${m.mensaje}`);
}
```

### Firmar sin emitir (`prepare`)

Para firmar ahora y despachar después (cola, lote, worker):

```ts
const { claveAcceso, signedXml } = sri.prepare(factura);
// Persista SIEMPRE el par antes de enviarlo: la claveAcceso es el único
// identificador con el que se puede resolver el comprobante ante el SRI.
await miRepositorio.guardar(claveAcceso, signedXml);
```

### Ante un fallo de red

Un `CommunicationError` **no** se convierte en `EmissionResult` — se lanza, porque no permite saber si el comprobante llegó a procesarse. El error trae el comprobante en vuelo:

```ts
import { CommunicationError } from 'sri-ec';

try {
  await sri.emit(factura);
} catch (err) {
  if (err instanceof CommunicationError && err.claveAcceso) {
    await miRepositorio.guardar(err.claveAcceso, err.signedXml!);
    // Resuelva el estado real con authorize(), NUNCA con un emit() nuevo:
    // un emit() nuevo acuñaría otra clave y duplicaría el secuencial.
    const estado = await sri.authorize(err.claveAcceso);
    console.log(estado.estado);
  }
  throw err;
}
```

## API principal

| Miembro | Descripción |
|---|---|
| `new SriClient({ ambiente, certificate, transport?, signer?, validate? })` | Cliente de emisión individual. |
| `sri.emit(doc, claveAcceso?)` | Valida → firma → recepción → autorización. Devuelve `EmissionResult`. |
| `sri.prepare(doc, claveAcceso?)` | Valida → firma, sin tocar la red. Devuelve `{ claveAcceso, signedXml }`. |
| `sri.authorize(claveAcceso)` | Re-consulta el estado de una clave ya enviada. |
| `sri.sign(xml)` | Firma un XML ya serializado. |
| `new BatchEmitter({ ambiente, ... })` | Envío masivo con reintentos y backoff configurables. |
| `loadCertificate(p12, password)` | Carga un `.p12`/`.pfx` (moderno o legacy). |
| `generarClaveAcceso({ ... })` | Clave de acceso de 49 dígitos (Módulo 11). |
| `validarRucLocal` / `validarRucChecksum` / `validarRucOnline` | Validación de RUC. |

La referencia completa (envío masivo, transporte propio, troubleshooting de zona horaria y certificados legacy) está en el [README del repositorio](https://github.com/JonathanTeran/teran-sri-ec-node#readme).

## NestJS

Para aplicaciones NestJS existe el módulo de inyección de dependencias complementario: [`sri-ec-nestjs`](https://www.npmjs.com/package/sri-ec-nestjs).

## Licencia

MIT © Jonathan Terán — ver [LICENSE.md](./LICENSE.md).
