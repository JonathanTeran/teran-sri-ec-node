/**
 * Smoke test real del flujo completo contra el ambiente de PRUEBAS del SRI.
 *
 * ADVERTENCIA — este script NO es un mock: firma una factura mínima con un
 * certificado real y la envía al servicio SOAP de pruebas del SRI
 * (https://celcer.sri.gob.ec), tal como lo haría en producción. Ejecútelo
 * solo cuando quiera verificar conectividad + certificado + datos del emisor
 * contra el SRI real. NO lo ejecute en CI ni de forma automática.
 *
 * El certificado nunca sale de esta máquina: solo se usa localmente (en
 * memoria) para calcular la firma XAdES-BES antes de enviar el XML.
 *
 * Variables de entorno:
 *   SRI_P12_PATH      Ruta al certificado .p12 (obligatoria).
 *   SRI_P12_PASSWORD  Contraseña del .p12 (obligatoria).
 *   SRI_RUC           RUC del emisor, 13 dígitos (obligatoria).
 *   SRI_ESTAB         Establecimiento, 3 dígitos (opcional, default '001').
 *   SRI_PTO_EMI       Punto de emisión, 3 dígitos (opcional, default '001').
 *   SRI_SECUENCIAL    Secuencial, 9 dígitos (opcional, default '000000001').
 *
 * Uso:
 *   SRI_P12_PATH=/ruta/a/firma.p12 SRI_P12_PASSWORD=clave SRI_RUC=1790011001001 \
 *     npx tsx examples/smoke-pruebas-sri.ts
 *
 * Recomendado: ejecutar con TZ=America/Guayaquil (ver README, Troubleshooting)
 * para que `fechaEmision` y `etsi:SigningTime` coincidan con la hora de
 * Ecuador que espera el SRI.
 */
import { readFileSync } from 'node:fs';

import {
  Ambiente,
  FetchSoapTransport,
  FormaPago,
  TipoComprobante,
  TipoEmision,
  XadesSigner,
  certificateInfo,
  generarClaveAcceso,
  loadCertificate,
  serializerFor,
  type Factura,
} from 'sri-ec';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta la variable de entorno ${name}. Vea el encabezado de este archivo.`);
    process.exit(1);
  }
  return value;
}

const p12Path = requireEnv('SRI_P12_PATH');
const p12Password = requireEnv('SRI_P12_PASSWORD');
const ruc = requireEnv('SRI_RUC');
const estab = process.env['SRI_ESTAB'] ?? '001';
const ptoEmi = process.env['SRI_PTO_EMI'] ?? '001';
const secuencial = process.env['SRI_SECUENCIAL'] ?? '000000001';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Código numérico aleatorio de 8 dígitos que exige `generarClaveAcceso`. */
function codigoNumAleatorio(): string {
  return Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0');
}

function fechaHoyEcuador(): { conBarras: string; sinBarras: string } {
  const hoy = new Date();
  const pad = (valor: number): string => String(valor).padStart(2, '0');
  const dd = pad(hoy.getDate());
  const mm = pad(hoy.getMonth() + 1);
  const yyyy = String(hoy.getFullYear());
  return { conBarras: `${dd}/${mm}/${yyyy}`, sinBarras: `${dd}${mm}${yyyy}` };
}

function logMensajes(mensajes: ReadonlyArray<{ identificador: string; tipo?: string; mensaje: string }>): void {
  for (const mensaje of mensajes) {
    console.log(`     - [${mensaje.identificador}] ${mensaje.tipo ?? ''}: ${mensaje.mensaje}`);
  }
}

async function main(): Promise<void> {
  console.log('== SMOKE TEST -> SRI PRUEBAS ==\n');

  // 1) Cargar certificado.
  const p12 = readFileSync(p12Path);
  const certificate = loadCertificate(p12, p12Password);
  const info = certificateInfo(certificate);
  console.log(
    `1) Certificado cargado. Emisor: ${info.issuerRfc4514} (vence ${info.notAfter.toISOString()})`,
  );

  // 2) Clave de acceso (módulo 11) con la fecha de hoy. Este ejemplo usa las
  //    piezas de bajo nivel directamente (en vez de `SriClient.emit()`) para
  //    mostrar cada paso del flujo por separado, igual que el smoke test del
  //    paquete PHP (`examples/smoke-prueba-sri.php`).
  const fecha = fechaHoyEcuador();
  const claveAcceso = generarClaveAcceso({
    fecha: fecha.sinBarras,
    tipoComprobante: TipoComprobante.Factura,
    ruc,
    ambiente: Ambiente.Pruebas,
    serie: `${estab}${ptoEmi}`,
    numero: secuencial,
    codigoNum: codigoNumAleatorio(),
  });
  console.log(`2) Clave de acceso: ${claveAcceso}`);

  // 3) Factura mínima (consumidor final, monto < $50) -> serializar -> firmar.
  const factura: Factura = {
    tipo: TipoComprobante.Factura,
    infoTributaria: {
      ambiente: Ambiente.Pruebas,
      razonSocial: 'EMISOR DE PRUEBA',
      ruc,
      estab,
      ptoEmi,
      secuencial,
      dirMatriz: 'Quito, Ecuador',
      tipoEmision: TipoEmision.Normal,
    },
    fechaEmision: fecha.conBarras,
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

  const xml = serializerFor(factura.tipo).serialize(factura, claveAcceso);
  const signedXml = new XadesSigner().sign(xml, certificate);
  console.log(`3) Factura serializada y firmada (XAdES-BES). ${signedXml.length} bytes.\n`);

  const transport = new FetchSoapTransport();

  // 4) RECEPCIÓN — llamada real al SRI de pruebas.
  console.log('4) Enviando al SRI (recepción)...');
  const recepcion = await transport.enviar(signedXml, Ambiente.Pruebas);
  console.log(`   -> estado: ${recepcion.estado}`);
  logMensajes(recepcion.mensajes);

  if (recepcion.estado !== 'RECIBIDA') {
    console.log(
      '\nEl SRI no recibió el comprobante. Revise los mensajes de arriba (suele ser datos del emisor/RUC en pruebas).',
    );
    console.log('IMPORTANTE: que el transporte haya traído esta respuesta ya confirma que la comunicación funciona.');
    return;
  }

  // 5) AUTORIZACIÓN — el SRI procesa de forma asíncrona: se reintenta unas
  //    pocas veces con espera entre intentos. `BatchEmitter` automatiza este
  //    mismo patrón para lotes (ver README, sección "Envío masivo").
  console.log('\n5) Consultando autorización (procesamiento asíncrono del SRI)...');
  await sleep(4000);

  let estadoFinal = 'EN PROCESO';
  for (let intento = 1; intento <= 12; intento++) {
    const auth = await transport.autorizar(claveAcceso, Ambiente.Pruebas);
    console.log(`   intento ${intento} -> estado: ${auth.estado}`);
    logMensajes(auth.mensajes);

    estadoFinal = auth.estado.toUpperCase();
    if (estadoFinal === 'EN PROCESO' || estadoFinal === 'EN PROCESAMIENTO') {
      console.log('     (en proceso, reintentando en 5s...)');
      await sleep(5000);
      continue;
    }

    if (estadoFinal === 'AUTORIZADO') {
      console.log(`\nAUTORIZADO. Nº ${auth.numeroAutorizacion} - ${auth.fechaAutorizacion}`);
      console.log('El flujo completo funciona contra el SRI con su certificado.');
    } else {
      console.log(`\nEstado final: ${auth.estado}. Revise los mensajes (regla de negocio de la factura).`);
    }
    break;
  }

  if (estadoFinal === 'EN PROCESO' || estadoFinal === 'EN PROCESAMIENTO') {
    console.log('\nEl SRI de pruebas sigue procesando (es asíncrono y a veces se congestiona).');
    console.log(`La firma y el envío fueron correctos. Consulte el estado final luego con la clave:\n  ${claveAcceso}`);
  }

  console.log('\n== Fin ==');
}

main().catch((err: unknown) => {
  console.error('Error inesperado en el smoke test:', err);
  process.exitCode = 1;
});
