import { Inject, Injectable } from '@nestjs/common';
import { BatchEmitter, type BatchEmitterOptions, type Comprobante, SriClient } from '@amephia/sri-ec';

import type { SriModuleOptions } from './interfaces.js';
import { SRI_CLIENT, SRI_MODULE_OPTIONS } from './tokens.js';

/**
 * Fachada NestJS de `SriClient`: expone el cliente ya configurado por
 * {@link SriModule} como provider inyectable, más `createBatch()` para
 * obtener un `BatchEmitter` preconfigurado con el mismo `ambiente`/
 * `transport` del módulo. Sin lógica propia — cada método delega
 * íntegramente en `@amephia/sri-ec`; este paquete es wiring de DI, no una
 * reimplementación.
 */
@Injectable()
export class SriService {
  constructor(
    @Inject(SRI_CLIENT) readonly client: SriClient,
    @Inject(SRI_MODULE_OPTIONS) private readonly moduleOptions: SriModuleOptions,
  ) {}

  /** Delega en `SriClient.emit()`. */
  emit(doc: Comprobante, claveAcceso?: string): ReturnType<SriClient['emit']> {
    return this.client.emit(doc, claveAcceso);
  }

  /** Delega en `SriClient.authorize()`. */
  authorize(claveAcceso: string): ReturnType<SriClient['authorize']> {
    return this.client.authorize(claveAcceso);
  }

  /** Delega en `SriClient.sign()`. */
  sign(xml: string): string {
    return this.client.sign(xml);
  }

  /**
   * `BatchEmitter` nuevo, preconfigurado con el `ambiente`/`transport` del
   * módulo — `opts` puede sobreescribir cualquier campo (p.ej.
   * `retryPolicy`, `repository`, `rateLimiter`, o incluso `ambiente`/
   * `transport` para un lote puntual con otra configuración).
   */
  createBatch(opts: Partial<BatchEmitterOptions> = {}): BatchEmitter {
    return new BatchEmitter({
      ambiente: this.moduleOptions.ambiente,
      transport: this.moduleOptions.transport,
      ...opts,
    });
  }
}
