/**
 * Reloj inyectable (port de `Teran\Sri\Signing\ClockInterface`): permite fijar
 * el instante de firma en los tests y hace determinista el sufijo de los ids
 * del XAdES, que se deriva de la fecha de firma.
 */
export interface Clock {
  now(): Date;
}

/** Reloj del sistema (port de `Teran\Sri\Signing\SystemClock`). */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
