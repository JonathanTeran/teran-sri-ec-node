/**
 * Ejemplo: envío masivo a partir de documentos, usando `SriClient.prepare()`
 * como puente hacia `BatchEmitter`.
 *
 * `BatchEmitter` trabaja sobre pares `(claveAcceso, signedXml)` ya listos —
 * no sobre `Comprobante`. `prepare()` es exactamente la mitad local de
 * `emit()` (validar → generar/verificar la clave de acceso → serializar →
 * firmar XAdES-BES) y devuelve ese par sin tocar la red, que es lo que un
 * flujo de lote necesita: firmar y PERSISTIR primero, despachar después.
 *
 * Reimplementar ese paso por fuera no es viable: la generación de la clave de
 * acceso depende de detalles internos (código numérico aleatorio de 8 dígitos
 * y, para `GuiaRemision`, `fechaIniTransporte` en vez de `fechaEmision`,
 * porque una guía no modela fecha de emisión).
 *
 * ADVERTENCIA: contacta el servicio real de PRUEBAS del SRI
 * (https://celcer.sri.gob.ec) — no es un mock.
 *
 * Uso:
 *   SRI_P12_PATH=/ruta/a/firma.p12 SRI_P12_PASSWORD=clave SRI_RUC=1790011001001 \
 *     npx tsx examples/lote-con-prepare.ts
 *
 * Recomendado: ejecutar con `TZ=America/Guayaquil` (ver README, Troubleshooting).
 */
import { readFileSync } from 'node:fs';

import {
  Ambiente,
  BatchEmitter,
  FormaPago,
  loadCertificate,
  RetryPolicy,
  SriClient,
  TipoComprobante,
  TipoEmision,
  type Comprobante,
  type Factura,
} from '@amephia/sri-ec';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta la variable de entorno ${name}.`);
    process.exit(1);
  }
  return value;
}

const p12Path = requireEnv('SRI_P12_PATH');
const p12Password = requireEnv('SRI_P12_PASSWORD');
const ruc = requireEnv('SRI_RUC');

/** "Base de datos" de comprobantes firmados. En una app real: una tabla. */
const repositorio = new Map<string, string>();

async function main(): Promise<void> {
  const certificate = loadCertificate(readFileSync(p12Path), p12Password);
  const ambiente = Ambiente.Pruebas;

  const sri = new SriClient({ ambiente, certificate });
  const retryPolicy = new RetryPolicy();
  const batch = new BatchEmitter({ ambiente, retryPolicy });

  // 1) Firmar cada documento y PERSISTIR el par (claveAcceso, signedXml)
  //    ANTES de encolarlo. Una vez que el XML sale a la red, la clave de
  //    acceso es el único identificador con el que se puede resolver el
  //    comprobante ante el SRI.
  for (const doc of documentos()) {
    const { claveAcceso, signedXml } = sri.prepare(doc);
    repositorio.set(claveAcceso, signedXml);
    batch.add(claveAcceso, signedXml); // idempotente por clave de acceso
  }

  console.log(`Preparados ${repositorio.size} comprobantes.`);

  // 2) Drenar el lote. `run()` NUNCA espera internamente: retorna en cuanto
  //    una pasada completa no logra avanzar ningún comprobante (p.ej. todos
  //    siguen EN_PROCESO). El pacing es responsabilidad del caller — en
  //    producción, un job encolado con retraso (BullMQ, SQS, cron) en vez de
  //    este setTimeout.
  for (let intento = 1; intento <= retryPolicy.maxAttempts; intento++) {
    await batch.run();

    const { SENT, IN_PROCESS } = batch.status();
    if (SENT + IN_PROCESS === 0) {
      break; // solo quedan estados terminales
    }

    const esperaMs = retryPolicy.delaySeconds(intento) * 1000;
    console.log(`Quedan ${SENT + IN_PROCESS} en vuelo; reintento en ${esperaMs / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }

  // 3) Resultado por comprobante.
  console.log('Conteo final:', batch.status());
  for (const claveAcceso of repositorio.keys()) {
    const item = batch.result(claveAcceso);
    console.log(`  ${claveAcceso} → ${item?.state ?? 'DESCONOCIDO'}`);
  }
}

/** Dos facturas mínimas de consumidor final, con secuenciales distintos. */
function documentos(): Comprobante[] {
  return ['000000001', '000000002'].map((secuencial) => facturaMinima(secuencial));
}

function facturaMinima(secuencial: string): Factura {
  return {
    tipo: TipoComprobante.Factura,
    infoTributaria: {
      ambiente: Ambiente.Pruebas,
      razonSocial: 'EMISOR DE PRUEBA',
      ruc,
      estab: '001',
      ptoEmi: '001',
      secuencial,
      dirMatriz: 'Quito, Ecuador',
      tipoEmision: TipoEmision.Normal,
    },
    fechaEmision: fechaHoyEcuador(),
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
}

/** Fecha de hoy en formato `dd/mm/yyyy` que exige el SRI para `fechaEmision`. */
function fechaHoyEcuador(): string {
  const hoy = new Date();
  const pad = (valor: number): string => String(valor).padStart(2, '0');
  return `${pad(hoy.getDate())}/${pad(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
}

main().catch((err: unknown) => {
  console.error('Error al procesar el lote:', err);
  process.exitCode = 1;
});
