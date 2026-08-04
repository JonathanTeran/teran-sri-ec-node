/**
 * Catálogo de Formas de Pago SRI Ecuador (port de `src/Catalogs/PaymentMethods.php`).
 *
 * Se modela como objeto `const` (no `enum`) porque, a diferencia de los
 * catálogos de `catalogs/index.ts`, el valor útil para el consumidor de la
 * librería es únicamente el código string — no hace falta un tipo enum
 * nominal, y un objeto `as const` permite derivar el tipo unión de códigos
 * sin generar un objeto helper adicional en tiempo de ejecución.
 */
export const FormaPago = {
  /** Sin utilización del sistema financiero (Efectivo) */
  EFECTIVO: '01',
  /** Compensación de deudas */
  COMPENSACION_DEUDAS: '15',
  /** Tarjeta de débito */
  TARJETA_DEBITO: '16',
  /** Dinero electrónico */
  DINERO_ELECTRONICO: '17',
  /** Tarjeta prepago */
  TARJETA_PREPAGO: '18',
  /** Tarjeta de crédito */
  TARJETA_CREDITO: '19',
  /** Otros con utilización del sistema financiero */
  OTROS_SISTEMA_FINANCIERO: '20',
  /** Endoso de títulos */
  ENDOSO_TITULOS: '21',
} as const;

/** Código de forma de pago válido según el catálogo SRI. */
export type FormaPago = (typeof FormaPago)[keyof typeof FormaPago];
