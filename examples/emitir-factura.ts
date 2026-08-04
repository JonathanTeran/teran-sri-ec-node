/**
 * Ejemplo: emitir una Factura electrónica contra el ambiente de PRUEBAS del SRI.
 *
 * Carga un certificado .p12, arma una factura mínima (consumidor final),
 * la emite con `SriClient.emit()` (valida → genera clave de acceso → serializa
 * → firma XAdES-BES → envía recepción → consulta autorización) e imprime el
 * resultado.
 *
 * ADVERTENCIA: este ejemplo SÍ contacta el servicio real de pruebas del SRI
 * (https://celcer.sri.gob.ec) — no es un mock. Necesita un certificado .p12
 * válido y un RUC de pruebas (o de producción, siempre que se declare
 * `ambiente=1` como aquí).
 *
 * Uso:
 *   SRI_P12_PATH=/ruta/a/firma.p12 SRI_P12_PASSWORD=clave SRI_RUC=1790011001001 \
 *     npx tsx examples/emitir-factura.ts
 *
 * Recomendado: ejecutar con `TZ=America/Guayaquil` en el entorno — la hora de
 * firma (`etsi:SigningTime`) usa la zona horaria del proceso, y el SRI puede
 * rechazar comprobantes con "FECHA EMISIÓN EXTEMPORÁNEA" si el reloj local no
 * coincide con la hora de Ecuador (ver README, sección Troubleshooting).
 */
import { readFileSync } from 'node:fs';

import {
  Ambiente,
  FormaPago,
  loadCertificate,
  SriClient,
  TipoComprobante,
  TipoEmision,
  type Factura,
} from '@amephia/sri-ec';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Falta la variable de entorno ${name} (SRI_P12_PATH, SRI_P12_PASSWORD y SRI_RUC son obligatorias).`,
    );
    process.exit(1);
  }
  return value;
}

const p12Path = requireEnv('SRI_P12_PATH');
const p12Password = requireEnv('SRI_P12_PASSWORD');
const ruc = requireEnv('SRI_RUC');

async function main(): Promise<void> {
  // 1) Cargar el certificado .p12. `loadCertificate` funciona igual con
  //    certificados legacy (RC2/3DES, pre-2024): node-forge los descifra de
  //    forma nativa, sin necesitar OpenSSL 1.1 como sí requiere el paquete PHP.
  const p12 = readFileSync(p12Path);
  const certificate = loadCertificate(p12, p12Password);

  // 2) Construir la factura. Todos los montos se modelan como `string`
  //    (nunca `number`) para no perder precisión decimal.
  const factura: Factura = {
    tipo: TipoComprobante.Factura,
    infoTributaria: {
      ambiente: Ambiente.Pruebas,
      razonSocial: 'EMISOR DE PRUEBA',
      ruc,
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000001',
      dirMatriz: 'Quito, Ecuador',
      tipoEmision: TipoEmision.Normal,
    },
    fechaEmision: fechaHoyEcuador(),
    // Consumidor final (tipo '07'): el monto debe ser menor a $50, regla de
    // negocio del SRI para no exigir identificación real del comprador.
    tipoIdentificacionComprador: '07',
    razonSocialComprador: 'CONSUMIDOR FINAL',
    identificacionComprador: '9999999999999',
    totalSinImpuestos: '10.00',
    totalDescuento: '0.00',
    importeTotal: '11.50',
    totalConImpuestos: [
      { codigo: '2', codigoPorcentaje: '4', baseImponible: '10.00', valor: '1.50' },
    ],
    detalles: [
      {
        codigoPrincipal: 'PROD-001',
        descripcion: 'Producto de prueba',
        cantidad: '1.000000',
        precioUnitario: '10.000000',
        descuento: '0.00',
        precioTotalSinImpuesto: '10.00',
        impuestos: [
          { codigo: '2', codigoPorcentaje: '4', tarifa: '15.00', baseImponible: '10.00', valor: '1.50' },
        ],
      },
    ],
    pagos: [{ formaPago: FormaPago.EFECTIVO, total: '11.50' }],
  };

  // 3) Emitir. Por defecto `SriClient` valida (zod + BusinessValidator antes
  //    de firmar), usa `FetchSoapTransport` (fetch nativo) y firma con SHA-1
  //    (lo que el SRI valida hoy).
  const sri = new SriClient({ ambiente: Ambiente.Pruebas, certificate });
  const resultado = await sri.emit(factura);

  // 4) Resultado. `resultado.status` es 'AUTORIZADO' | 'RECHAZADO' | 'EN_PROCESO'.
  //    Un 'RECHAZADO' en RECEPCION significa que el comprobante nunca entró al
  //    sistema del SRI (XML/clave inválidos); en AUTORIZACION significa que sí
  //    entró, pero una regla de negocio o duplicado lo rechazó después.
  console.log('Clave de acceso:', resultado.claveAcceso);
  console.log('Estado:', resultado.status, resultado.rejectedStage ? `(${resultado.rejectedStage})` : '');

  if (resultado.status === 'AUTORIZADO') {
    console.log('Número de autorización:', resultado.numeroAutorizacion);
    console.log('Fecha de autorización:', resultado.fechaAutorizacion);
  } else {
    for (const mensaje of resultado.messages) {
      console.log(`  - [${mensaje.identificador}] ${mensaje.mensaje}`);
    }
  }
}

/** Fecha de hoy en formato `dd/mm/yyyy` que exige el SRI para `fechaEmision`. */
function fechaHoyEcuador(): string {
  const hoy = new Date();
  const pad = (valor: number): string => String(valor).padStart(2, '0');
  return `${pad(hoy.getDate())}/${pad(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
}

main().catch((err: unknown) => {
  console.error('Error al emitir la factura:', err);
  process.exitCode = 1;
});
