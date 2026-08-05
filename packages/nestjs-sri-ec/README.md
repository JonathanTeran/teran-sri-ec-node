# sri-ec-nestjs

[![npm version](https://img.shields.io/npm/v/sri-ec-nestjs.svg?style=flat-square)](https://www.npmjs.com/package/sri-ec-nestjs) [![Licencia MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](https://github.com/JonathanTeran/teran-sri-ec-node/blob/main/LICENSE.md) [![Node.js](https://img.shields.io/badge/node-%3E%3D%2020-339933.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

Módulo de inyección de dependencias para **NestJS** sobre [`sri-ec`](https://www.npmjs.com/package/sri-ec), la librería de **Facturación Electrónica del SRI Ecuador**. Wiring puro (`SriModule.forRoot()` / `forRootAsync()` + `SriService`), sin lógica de negocio propia: cada método de `SriService` delega íntegramente en el núcleo.

- 📖 **Documentación completa:** <https://github.com/JonathanTeran/teran-sri-ec-node>
- 🐛 **Reportar un problema:** <https://github.com/JonathanTeran/teran-sri-ec-node/issues>

## Instalación

```bash
npm install sri-ec sri-ec-nestjs
```

Requiere **Node.js >= 20**. Peer dependencies: `sri-ec@^0.2.0` y `@nestjs/common@^10 || ^11`.

## Uso

### Registro del módulo

```ts
import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { Ambiente } from 'sri-ec';
import { SriModule } from 'sri-ec-nestjs';

@Module({
  imports: [
    SriModule.forRoot({
      ambiente: Ambiente.Pruebas,
      certificate: {
        p12: readFileSync('firma.p12'),
        password: process.env['SRI_P12_PASSWORD']!,
      },
      // isGlobal: true,   // opcional, false por defecto
      // validate: false,  // opcional, salta assertValid() antes de firmar
    }),
  ],
})
export class AppModule {}
```

`certificate` acepta también un `Certificate` ya cargado con `loadCertificate()`. El `.p12` y su contraseña se consumen al construir el cliente y **nunca quedan registrados en el contenedor de Nest**.

`SriModule.forRoot()` carga el certificado **al evaluar la definición del módulo** (en la propia llamada a `forRoot()`, antes de que Nest compile nada): un `.p12` corrupto o una contraseña incorrecta fallan de inmediato, en el import del módulo, con `CertificateError`, en vez de en la primera inyección de `SriService`/`SRI_CLIENT`. Con `forRootAsync()` la carga ocurre al ejecutarse la `useFactory`, durante la compilación del módulo.

### Uso en un servicio

```ts
import { Injectable } from '@nestjs/common';
import type { Factura } from 'sri-ec';
import { SriService } from 'sri-ec-nestjs';

@Injectable()
export class FacturacionService {
  constructor(private readonly sri: SriService) {}

  emitir(factura: Factura) {
    return this.sri.emit(factura); // delega en SriClient.emit()
  }

  firmarSinEnviar(factura: Factura) {
    return this.sri.prepare(factura); // { claveAcceso, signedXml }
  }

  lote() {
    return this.sri.createBatch(); // BatchEmitter con el ambiente/transport del módulo
  }
}
```

### Configuración asíncrona

```ts
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Ambiente, loadCertificate } from 'sri-ec';
import { SriModule } from 'sri-ec-nestjs';

SriModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    ambiente: config.getOrThrow<Ambiente>('SRI_AMBIENTE'),
    certificate: loadCertificate(
      config.getOrThrow<Buffer>('SRI_P12'),
      config.getOrThrow<string>('SRI_P12_PASSWORD'),
    ),
  }),
});
```

Mismo patrón que `ConfigModule.forRootAsync` / `TypeOrmModule.forRootAsync`: por el encapsulamiento estándar de Nest, la `useFactory` solo ve los providers declarados en sus propios `imports`.

## API

| Miembro | Descripción |
|---|---|
| `SriModule.forRoot(options)` | Registro síncrono. |
| `SriModule.forRootAsync({ imports?, inject?, useFactory, isGlobal? })` | Registro asíncrono. |
| `SriService` | Fachada inyectable: `emit`, `prepare`, `authorize`, `sign`, `createBatch`, y el `client` crudo. |
| `SRI_CLIENT` | Token del `SriClient` configurado, por si se prefiere inyectarlo directamente. |
| `SRI_MODULE_OPTIONS` | Token de la configuración no sensible (`ambiente`, `transport`, `validate`). |

La referencia completa de los comprobantes, la firma y el envío masivo está en el [README del repositorio](https://github.com/JonathanTeran/teran-sri-ec-node#readme).

## Licencia

MIT © Jonathan Terán — ver [LICENSE.md](./LICENSE.md).
