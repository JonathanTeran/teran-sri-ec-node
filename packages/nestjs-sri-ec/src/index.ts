/**
 * Punto de entrada público de `sri-ec-nestjs`: wiring de
 * inyección de dependencias sobre `sri-ec` para aplicaciones
 * NestJS. Sin lógica de negocio propia — mismo patrón de barrel que
 * `sri-ec/src/index.ts`.
 */
export * from './tokens.js';
export * from './interfaces.js';
export * from './sri.service.js';
export * from './sri.module.js';

