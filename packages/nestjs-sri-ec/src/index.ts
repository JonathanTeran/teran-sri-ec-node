/**
 * Punto de entrada público de `@amephia/nestjs-sri-ec`: wiring de
 * inyección de dependencias sobre `@amephia/sri-ec` para aplicaciones
 * NestJS. Sin lógica de negocio propia — mismo patrón de barrel que
 * `@amephia/sri-ec/src/index.ts`.
 */
export * from './tokens.js';
export * from './interfaces.js';
export * from './sri.service.js';
export * from './sri.module.js';

