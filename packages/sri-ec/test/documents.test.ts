import { describe, expect, it } from 'vitest';

import { Ambiente, TipoComprobante, TipoEmision } from '../src/catalogs/index.js';
import { FormaPago } from '../src/catalogs/forma-pago.js';
import type {
  Factura,
  GuiaRemision,
  LiquidacionCompra,
  NotaCredito,
  NotaDebito,
  Retencion,
} from '../src/documents/index.js';

/**
 * Test de tipos (compile-time): este archivo no verifica lógica de negocio,
 * verifica que `tsc --noEmit` acepte un fixture literal completo por cada
 * uno de los 6 comprobantes. Si algún campo obligatorio falta, o un tipo no
 * coincide, la compilación falla — esa es la prueba real.
 *
 * Los fixtures se exportan porque Tasks 5-8 (zod, BusinessValidator,
 * serializadores XML) los reutilizan tal cual.
 */

export const facturaFixture: Factura = {
  tipo: TipoComprobante.Factura,
  infoTributaria: {
    ambiente: Ambiente.Pruebas,
    razonSocial: 'COMERCIAL AMEPHIA S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000001',
    dirMatriz: 'Av. Amazonas N24-03 y Colón, Quito',
    tipoEmision: TipoEmision.Normal,
    nombreComercial: 'AMEPHIA',
  },
  fechaEmision: '03/08/2026',
  tipoIdentificacionComprador: '05',
  razonSocialComprador: 'Juan Pérez',
  identificacionComprador: '1710034065',
  direccionComprador: 'Calle Falsa 123, Quito',
  totalSinImpuestos: '100.00',
  totalDescuento: '0.00',
  propina: '0.00',
  importeTotal: '112.00',
  moneda: 'DOLAR',
  obligadoContabilidad: 'SI',
  totalConImpuestos: [
    { codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '12.00' },
  ],
  detalles: [
    {
      codigoPrincipal: 'PROD001',
      descripcion: 'Servicio de consultoría',
      cantidad: '1.000000',
      precioUnitario: '100.000000',
      descuento: '0.00',
      precioTotalSinImpuesto: '100.00',
      impuestos: [
        { codigo: '2', codigoPorcentaje: '4', tarifa: '12.00', baseImponible: '100.00', valor: '12.00' },
      ],
    },
  ],
  pagos: [{ formaPago: FormaPago.EFECTIVO, total: '112.00' }],
  infoAdicional: { Email: 'cliente@example.com' },
};

export const liquidacionCompraFixture: LiquidacionCompra = {
  tipo: TipoComprobante.LiquidacionCompra,
  infoTributaria: {
    ambiente: Ambiente.Pruebas,
    razonSocial: 'COMERCIAL AMEPHIA S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000002',
    dirMatriz: 'Av. Amazonas N24-03 y Colón, Quito',
    tipoEmision: TipoEmision.Normal,
  },
  fechaEmision: '03/08/2026',
  dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
  contribuyenteEspecial: '5368',
  tipoIdentificacionProveedor: '05',
  razonSocialProveedor: 'María Gómez',
  identificacionProveedor: '1710034065',
  direccionProveedor: 'Calle Sucre 456, Quito',
  totalSinImpuestos: '50.00',
  totalDescuento: '0.00',
  importeTotal: '56.00',
  moneda: 'DOLAR',
  obligadoContabilidad: 'SI',
  totalConImpuestos: [
    { codigo: '2', codigoPorcentaje: '4', baseImponible: '50.00', valor: '6.00' },
  ],
  detalles: [
    {
      codigoPrincipal: 'PROD002',
      descripcion: 'Compra de maíz duro',
      cantidad: '10.000000',
      precioUnitario: '5.000000',
      descuento: '0.00',
      precioTotalSinImpuesto: '50.00',
      impuestos: [
        { codigo: '2', codigoPorcentaje: '4', tarifa: '12.00', baseImponible: '50.00', valor: '6.00' },
      ],
    },
  ],
  pagos: [{ formaPago: FormaPago.EFECTIVO, total: '56.00' }],
  infoAdicional: { Observacion: 'Compra a productor local' },
};

export const notaCreditoFixture: NotaCredito = {
  tipo: TipoComprobante.NotaCredito,
  infoTributaria: {
    ambiente: Ambiente.Pruebas,
    razonSocial: 'COMERCIAL AMEPHIA S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000003',
    dirMatriz: 'Av. Amazonas N24-03 y Colón, Quito',
    tipoEmision: TipoEmision.Normal,
  },
  fechaEmision: '03/08/2026',
  dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
  tipoIdentificacionComprador: '05',
  razonSocialComprador: 'Juan Pérez',
  identificacionComprador: '1710034065',
  contribuyenteEspecial: '5368',
  obligadoContabilidad: 'SI',
  codDocModificado: '01',
  numDocModificado: '001-001-000000001',
  fechaEmisionDocSustento: '01/08/2026',
  totalSinImpuestos: '100.00',
  valorModificacion: '112.00',
  moneda: 'DOLAR',
  totalConImpuestos: [
    { codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '12.00' },
  ],
  detalles: [
    {
      codigoPrincipal: 'PROD001',
      descripcion: 'Devolución: servicio de consultoría',
      cantidad: '1.000000',
      precioUnitario: '100.000000',
      descuento: '0.00',
      precioTotalSinImpuesto: '100.00',
      impuestos: [
        { codigo: '2', codigoPorcentaje: '4', tarifa: '12.00', baseImponible: '100.00', valor: '12.00' },
      ],
    },
  ],
  motivo: 'Devolución de mercadería',
  infoAdicional: { Email: 'cliente@example.com' },
};

export const notaDebitoFixture: NotaDebito = {
  tipo: TipoComprobante.NotaDebito,
  infoTributaria: {
    ambiente: Ambiente.Pruebas,
    razonSocial: 'COMERCIAL AMEPHIA S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000004',
    dirMatriz: 'Av. Amazonas N24-03 y Colón, Quito',
    tipoEmision: TipoEmision.Normal,
  },
  fechaEmision: '03/08/2026',
  dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
  tipoIdentificacionComprador: '05',
  razonSocialComprador: 'Juan Pérez',
  identificacionComprador: '1710034065',
  contribuyenteEspecial: '5368',
  obligadoContabilidad: 'SI',
  rise: 'Contribuyente Régimen RISE',
  codDocModificado: '01',
  numDocModificado: '001-001-000000001',
  fechaEmisionDocSustento: '01/08/2026',
  totalSinImpuestos: '100.00',
  impuestos: [
    { codigo: '2', codigoPorcentaje: '4', baseImponible: '100.00', valor: '12.00' },
  ],
  valorTotal: '112.00',
  pagos: [{ formaPago: FormaPago.EFECTIVO, total: '112.00' }],
  motivos: [{ razon: 'Intereses por mora', valor: '100.00' }],
  infoAdicional: { Email: 'cliente@example.com' },
};

export const guiaRemisionFixture: GuiaRemision = {
  tipo: TipoComprobante.GuiaRemision,
  infoTributaria: {
    ambiente: Ambiente.Pruebas,
    razonSocial: 'COMERCIAL AMEPHIA S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000005',
    dirMatriz: 'Av. Amazonas N24-03 y Colón, Quito',
    tipoEmision: TipoEmision.Normal,
  },
  dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
  dirPartida: 'Bodega Central, Av. Eloy Alfaro N32-100, Quito',
  razonSocialTransportista: 'Transportes Rápidos S.A.',
  tipoIdentificacionTransportista: '04',
  rucTransportista: '1790011001001',
  fechaIniTransporte: '03/08/2026',
  fechaFinTransporte: '04/08/2026',
  placa: 'PBX1234',
  destinatarios: [
    {
      identificacionDestinatario: '1710034065',
      razonSocialDestinatario: 'Juan Pérez',
      dirDestinatario: 'Calle Falsa 123, Quito',
      motivoTraslado: 'Venta',
      detalles: [
        { codigoInterno: 'PROD001', descripcion: 'Caja de repuestos', cantidad: '5.00' },
      ],
      codDocSustento: '01',
      numDocSustento: '001-001-000000001',
      numAutDocSustento: '1234567890123',
      fechaEmisionDocSustento: '03/08/2026',
    },
  ],
  obligadoContabilidad: 'SI',
  contribuyenteEspecial: '5368',
  infoAdicional: { Email: 'transporte@example.com' },
};

export const retencionFixture: Retencion = {
  tipo: TipoComprobante.Retencion,
  infoTributaria: {
    ambiente: Ambiente.Pruebas,
    razonSocial: 'AGENTE RETENCION S.A.',
    ruc: '1790011001001',
    estab: '001',
    ptoEmi: '001',
    secuencial: '000000006',
    dirMatriz: 'Av. Amazonas N24-03 y Colón, Quito',
    tipoEmision: TipoEmision.Normal,
  },
  fechaEmision: '03/08/2026',
  dirEstablecimiento: 'Av. Amazonas N24-03, Quito',
  tipoIdentificacionSujetoRetenido: '04',
  razonSocialSujetoRetenido: 'Proveedor EC S.A.',
  identificacionSujetoRetenido: '1790011002001',
  periodoFiscal: '08/2026',
  contribuyenteEspecial: '5368',
  obligadoContabilidad: 'SI',
  tipoSujetoRetenido: '01',
  docsSustento: [
    {
      codSustento: '01',
      codDocSustento: '01',
      numDocSustento: '001-001-000000100',
      fechaEmisionDocSustento: '01/08/2026',
      totalSinImpuestos: '1000.00',
      importeTotal: '1120.00',
      impuestosDocSustento: [
        {
          codImpuestoDocSustento: '2',
          codigoPorcentaje: '4',
          baseImponible: '1000.00',
          tarifa: '12.00',
          factorProporcionalidad: '1.00',
          baseImponibleModificada: '1000.00',
          valorImpuesto: '120.00',
        },
      ],
      retenciones: [
        {
          codigo: '2',
          codigoRetencion: '303',
          baseImponible: '1000.00',
          porcentajeRetener: '10',
          valorRetenido: '100.00',
        },
      ],
      pagos: [{ formaPago: '01', total: '1020.00' }],
    },
  ],
  infoAdicional: { Email: 'contabilidad@example.com' },
};

describe('documents', () => {
  it('facturaFixture tiene el discriminante correcto', () => {
    expect(facturaFixture.tipo).toBe(TipoComprobante.Factura);
  });

  it('liquidacionCompraFixture tiene el discriminante correcto', () => {
    expect(liquidacionCompraFixture.tipo).toBe(TipoComprobante.LiquidacionCompra);
  });

  it('notaCreditoFixture tiene el discriminante correcto', () => {
    expect(notaCreditoFixture.tipo).toBe(TipoComprobante.NotaCredito);
  });

  it('notaDebitoFixture tiene el discriminante correcto', () => {
    expect(notaDebitoFixture.tipo).toBe(TipoComprobante.NotaDebito);
  });

  it('guiaRemisionFixture tiene el discriminante correcto', () => {
    expect(guiaRemisionFixture.tipo).toBe(TipoComprobante.GuiaRemision);
  });

  it('retencionFixture tiene el discriminante correcto', () => {
    expect(retencionFixture.tipo).toBe(TipoComprobante.Retencion);
  });
});
