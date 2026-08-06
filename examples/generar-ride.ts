/**
 * Ejemplo: emitir una Factura contra el ambiente de PRUEBAS del SRI y generar
 * su RIDE (PDF conforme al Anexo 2 del SRI, con código de barras Code 128 por
 * defecto) a partir del resultado.
 *
 * El RIDE vive en el subpath opcional `sri-ec/ride`: el core de `sri-ec`
 * (usado en `emitir-factura.ts`) no lo importa nunca, así que quien solo
 * emite/firma comprobantes no paga el costo de `pdfkit`. Este ejemplo sí lo
 * necesita — instálalo antes de ejecutarlo (`qrcode` solo hace falta si se
 * pasa `opciones: { incluirQr: true }`, ver README):
 *
 *   npm install pdfkit
 *
 * ADVERTENCIA: este ejemplo SÍ contacta el servicio real de pruebas del SRI
 * (https://celcer.sri.gob.ec) — no es un mock. Necesita un certificado .p12
 * válido y un RUC de pruebas (o de producción, siempre que se declare
 * `ambiente=1` como aquí).
 *
 * Uso:
 *   SRI_P12_PATH=/ruta/a/firma.p12 SRI_P12_PASSWORD=clave SRI_RUC=1790011001001 \
 *     npx tsx examples/generar-ride.ts
 *
 * Recomendado: ejecutar con `TZ=America/Guayaquil` en el entorno — ver
 * `examples/emitir-factura.ts` y el README (sección Troubleshooting) para el
 * porqué.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import {
  Ambiente,
  FormaPago,
  loadCertificate,
  SriClient,
  TipoComprobante,
  TipoEmision,
  type Factura,
} from 'sri-ec';
import { generarRide } from 'sri-ec/ride';

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
  // 1) Cargar el certificado .p12 (igual que en emitir-factura.ts).
  const p12 = readFileSync(p12Path);
  const certificate = loadCertificate(p12, p12Password);

  // 2) Construir la factura. `dirEstablecimiento`/`contribuyenteEspecial` son
  //    opcionales (nuevos en esta versión): si se pasan, el RIDE los imprime
  //    en el bloque emisor.
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
    dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
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

  // 3) Emitir contra el SRI de pruebas.
  const sri = new SriClient({ ambiente: Ambiente.Pruebas, certificate });
  const resultado = await sri.emit(factura);

  console.log('Clave de acceso:', resultado.claveAcceso);
  console.log('Estado:', resultado.status, resultado.rejectedStage ? `(${resultado.rejectedStage})` : '');

  // 4) Generar el RIDE a partir del MISMO documento y de la clave de acceso
  //    que acaba de emitirse. Si el SRI ya autorizó (respuesta síncrona en
  //    pruebas), se imprime número y fecha de autorización; si quedó
  //    `EN_PROCESO`, se pasa sin `autorizacion` y el RIDE sale igual, con la
  //    cabecera marcada "NO AUTORIZADO" (el SRI autoriza de forma asíncrona).
  const pdf = await generarRide({
    documento: factura,
    claveAcceso: resultado.claveAcceso,
    autorizacion:
      resultado.status === 'AUTORIZADO' && resultado.numeroAutorizacion && resultado.fechaAutorizacion
        ? { numero: resultado.numeroAutorizacion, fecha: resultado.fechaAutorizacion }
        : undefined,
  });

  // 5) Escribir el PDF a disco. `generarRide()` nunca toca el filesystem por
  //    su cuenta — devuelve los bytes (`Uint8Array`) y el caller decide dónde
  //    guardarlos (aquí, `node:fs`; en un servidor, la respuesta HTTP).
  const rutaSalida = `factura-${resultado.claveAcceso}.pdf`;
  writeFileSync(rutaSalida, pdf);
  console.log('RIDE escrito en:', rutaSalida);
}

/** Fecha de hoy en formato `dd/mm/yyyy` que exige el SRI para `fechaEmision`. */
function fechaHoyEcuador(): string {
  const hoy = new Date();
  const pad = (valor: number): string => String(valor).padStart(2, '0');
  return `${pad(hoy.getDate())}/${pad(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
}

main().catch((err: unknown) => {
  console.error('Error al generar el RIDE:', err);
  process.exitCode = 1;
});
