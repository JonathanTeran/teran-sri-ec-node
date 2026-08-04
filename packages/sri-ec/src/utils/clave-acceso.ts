import { ValidationError } from '../errors/index.js';

/**
 * Genera la clave de acceso completa (48 dígitos + dígito verificador).
 * Implementa el algoritmo Módulo 11 según la ficha técnica del SRI.
 *
 * @param p.fecha Formato 'dd/mm/yyyy' o 'ddmmyyyy'
 * @param p.tipoComprobante (01: Factura, 04: Nota de Crédito, etc.)
 * @param p.ruc
 * @param p.ambiente (1: Pruebas, 2: Producción)
 * @param p.serie (Establecimiento + Punto de Emisión, 6 dígitos)
 * @param p.numero (9 dígitos)
 * @param p.codigoNum (8 dígitos aleatorios o fijos)
 * @param p.tipoEmision (1: Normal, default '1')
 * @returns String de 49 dígitos
 */
export function generarClaveAcceso(p: {
  fecha: string;
  tipoComprobante: string;
  ruc: string;
  ambiente: string;
  serie: string;
  numero: string;
  codigoNum: string;
  tipoEmision?: string;
}): string {
  const tipoEmision = p.tipoEmision ?? '1';
  const fecha = p.fecha.replace(/\//g, '');

  const clave48 =
    fecha +
    p.tipoComprobante +
    p.ruc +
    p.ambiente +
    p.serie +
    p.numero +
    p.codigoNum +
    tipoEmision;

  // Validación: debe tener exactamente 48 dígitos y solo contener dígitos
  if (clave48.length !== 48) {
    throw new ValidationError(
      'Base de clave de acceso inválida',
      [`Debe tener 48 dígitos, actual: ${clave48.length}`],
    );
  }

  if (!/^\d+$/.test(clave48)) {
    throw new ValidationError('Base de clave de acceso inválida', [
      'Debe contener solo dígitos',
    ]);
  }

  const dv = calcularDigitoVerificador(clave48);

  return clave48 + dv;
}

/**
 * Calcula el dígito verificador usando el algoritmo Módulo 11.
 *
 * @param cadena48 String de 48 dígitos
 * @returns Dígito verificador (0-9)
 * @throws ValidationError si cadena48 no tiene exactamente 48 dígitos o contiene no-dígitos
 */
export function calcularDigitoVerificador(cadena48: string): number {
  // Validación
  if (cadena48.length !== 48) {
    throw new ValidationError(
      'Cadena para dígito verificador inválida',
      [`Debe tener 48 dígitos, actual: ${cadena48.length}`],
    );
  }

  if (!/^\d+$/.test(cadena48)) {
    throw new ValidationError('Cadena para dígito verificador inválida', [
      'Debe contener solo dígitos',
    ]);
  }

  // Algoritmo Módulo 11
  const invertida = cadena48.split('').reverse().join('');
  let suma = 0;
  let factor = 2;

  for (let i = 0; i < invertida.length; i++) {
    const digito = parseInt(invertida[i], 10);
    suma += digito * factor;

    factor++;
    if (factor > 7) {
      factor = 2;
    }
  }

  const residuo = suma % 11;
  let dv = 11 - residuo;

  // Casos especiales
  if (dv === 11) {
    return 0;
  }

  if (dv === 10) {
    return 1;
  }

  return dv;
}
