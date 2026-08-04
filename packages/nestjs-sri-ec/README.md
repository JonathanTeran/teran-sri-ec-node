# @amephia/nestjs-sri-ec

Módulo de inyección de dependencias para **NestJS** sobre [`@amephia/sri-ec`](../sri-ec). Wiring puro (`SriModule.forRoot()`/`forRootAsync()` + `SriService`) — sin lógica de negocio propia; cada método de `SriService` delega íntegramente en `SriClient`/`BatchEmitter` del núcleo.

Este paquete forma parte del monorepo [`teran-sri-ec-node`](../..). La documentación completa (instalación, ejemplos, flujo, troubleshooting) vive en el **[README de la raíz](../../README.md)**.

## Instalación

```bash
npm install @amephia/sri-ec @amephia/nestjs-sri-ec
```

Peer dependencies: `@amephia/sri-ec` y `@nestjs/common@^10 || ^11`.

## Uso mínimo

```ts
import { Module } from '@nestjs/common';
import { Ambiente } from '@amephia/sri-ec';
import { SriModule } from '@amephia/nestjs-sri-ec';

@Module({
  imports: [
    SriModule.forRoot({
      ambiente: Ambiente.Pruebas,
      certificate: { p12: p12Bytes, password: 'clave-del-p12' },
    }),
  ],
})
export class AppModule {}
```

Inyecte `SriService` (o el token `SRI_CLIENT` para el `SriClient` crudo) donde lo necesite. Ver el [README de la raíz](../../README.md) para la referencia completa, incluyendo `forRootAsync()` y `createBatch()`.

## Licencia

MIT — ver [LICENSE.md](../../LICENSE.md).
