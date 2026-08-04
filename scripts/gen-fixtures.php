<?php

declare(strict_types=1);

/**
 * Genera los fixtures XML dorados (golden) para los tests del serializador
 * TypeScript, usando la API v2 real del paquete PHP `teran-sri-ec`.
 *
 * IMPORTANTE: los datos construidos aquí deben reflejar EXACTAMENTE
 * `facturaFixture` de `packages/sri-ec/test/documents.test.ts` — en los
 * campos que el value object v2 de PHP (`Teran\Sri\Documents\Factura`) es
 * capaz de representar. Los siguientes campos existen en el fixture TS pero
 * NO en el v2 de PHP (ver `documents/factura.ts`, comentario de cabecera) y
 * por lo tanto NO aparecen en este XML dorado ni deben afectar el
 * subconjunto usado por el test golden en TypeScript:
 *
 *   - `direccionComprador` / `guiaRemision`: no existen en
 *     `Documents\Factura` (constructor) ni los escribe
 *     `FacturaXmlSerializer::infoFactura()`.
 *   - `propina`: `FacturaXmlSerializer::infoFactura()` escribe SIEMPRE el
 *     literal `'0.00'`, sin leerlo del objeto Factura (que ni lo modela).
 *   - `moneda`: `FacturaXmlSerializer::infoFactura()` escribe SIEMPRE el
 *     literal `'DOLAR'`, sin leerlo del objeto Factura.
 *   - `infoAdicional`: no hay ningún método `infoAdicional()` en
 *     `FacturaXmlSerializer` (v2) — el bloque `<infoAdicional>` no se
 *     serializa en absoluto.
 *
 * La clave de acceso es fija (mismos parámetros usados por el test TS) para
 * que la comparación golden sea determinista y reproducible.
 *
 * Uso:
 *   php scripts/gen-fixtures.php
 *
 * Requiere que el paquete PHP hermano tenga `composer install` corrido
 * (vendor/autoload.php presente).
 */

require '/Users/jonathanteran/desarrollo/paquetes/teran-sri-ec/vendor/autoload.php';

use Teran\Sri\Documents\Factura;
use Teran\Sri\Documents\GuiaRemision;
use Teran\Sri\Documents\LiquidacionCompra;
use Teran\Sri\Documents\NotaCredito;
use Teran\Sri\Documents\NotaDebito;
use Teran\Sri\Documents\Retencion;
use Teran\Sri\Utils\ClaveAcceso;
use Teran\Sri\Xml\FacturaXmlSerializer;
use Teran\Sri\Xml\GuiaRemisionXmlSerializer;
use Teran\Sri\Xml\LiquidacionCompraXmlSerializer;
use Teran\Sri\Xml\NotaCreditoXmlSerializer;
use Teran\Sri\Xml\NotaDebitoXmlSerializer;
use Teran\Sri\Xml\RetencionXmlSerializer;

$claveAcceso = ClaveAcceso::generar(
    fecha: '03/08/2026',
    tipoComprobante: '01',
    ruc: '1790011001001',
    ambiente: '1',
    serie: '001001',
    numero: '000000001',
    codigoNum: '12345678',
    tipoEmision: '1',
);

$factura = Factura::fromArray([
    'infoTributaria' => [
        'ambiente' => '1',
        'razonSocial' => 'COMERCIAL AMEPHIA S.A.',
        'nombreComercial' => 'AMEPHIA',
        'ruc' => '1790011001001',
        'estab' => '001',
        'ptoEmi' => '001',
        'secuencial' => '000000001',
        'dirMatriz' => 'Av. Amazonas N24-03 y Colón, Quito',
        'tipoEmision' => '1',
    ],
    'infoFactura' => [
        'fechaEmision' => '03/08/2026',
        'obligadoContabilidad' => 'SI',
        'tipoIdentificacionComprador' => '05',
        'razonSocialComprador' => 'Juan Pérez',
        'identificacionComprador' => '1710034065',
        'totalSinImpuestos' => '100.00',
        'totalDescuento' => '0.00',
        'importeTotal' => '112.00',
        'totalConImpuestos' => [
            ['codigo' => '2', 'codigoPorcentaje' => '4', 'baseImponible' => '100.00', 'valor' => '12.00'],
        ],
        'pagos' => [
            ['formaPago' => '01', 'total' => '112.00'],
        ],
    ],
    'detalles' => [
        [
            'codigoPrincipal' => 'PROD001',
            'descripcion' => 'Servicio de consultoría',
            'cantidad' => '1.000000',
            'precioUnitario' => '100.000000',
            'descuento' => '0.00',
            'precioTotalSinImpuesto' => '100.00',
            'impuestos' => [
                ['codigo' => '2', 'codigoPorcentaje' => '4', 'tarifa' => '12.00', 'baseImponible' => '100.00', 'valor' => '12.00'],
            ],
        ],
    ],
]);

$xml = (new FacturaXmlSerializer())->serialize($factura, $claveAcceso);

$outPath = __DIR__ . '/../packages/sri-ec/test/fixtures/factura.xml';
file_put_contents($outPath, $xml);

fwrite(STDERR, "claveAcceso: $claveAcceso\n");
fwrite(STDERR, "Escrito: $outPath (" . strlen($xml) . " bytes)\n");

/**
 * Task 8 — los otros 5 comprobantes. Mismo criterio que Factura arriba: los
 * datos de cada bloque reflejan EXACTAMENTE el `*Fixture` correspondiente de
 * `packages/sri-ec/test/documents.test.ts`, en el subconjunto representable
 * por el value object v2 de PHP (`Teran\Sri\Documents\*::fromArray()`). En
 * los 5 casos, el único campo del fixture TS que NO es representable en PHP
 * v2 es `infoAdicional` (ninguno de los 5 value objects v2 lo modela, así
 * que se omite aquí — ver el comentario de cada `*XmlSerializer.ts` en el
 * paquete Node para el detalle completo de campos opcionales adicionales
 * que SÍ soporta el serializador TS pero que no son representables en PHP
 * v2, o cuya representación en PHP v2 requiere una forma de datos distinta
 * — esos se cubren con tests directos en `test/xml-otros.test.ts`, no aquí).
 */

// --- LiquidacionCompra (codDoc 03) ---

$claveLiquidacionCompra = ClaveAcceso::generar(
    fecha: '03/08/2026',
    tipoComprobante: '03',
    ruc: '1790011001001',
    ambiente: '1',
    serie: '001001',
    numero: '000000002',
    codigoNum: '12345678',
    tipoEmision: '1',
);

$liquidacionCompra = LiquidacionCompra::fromArray([
    'infoTributaria' => [
        'ambiente' => '1',
        'razonSocial' => 'COMERCIAL AMEPHIA S.A.',
        'ruc' => '1790011001001',
        'estab' => '001',
        'ptoEmi' => '001',
        'secuencial' => '000000002',
        'dirMatriz' => 'Av. Amazonas N24-03 y Colón, Quito',
        'tipoEmision' => '1',
    ],
    'infoLiquidacionCompra' => [
        'fechaEmision' => '03/08/2026',
        'dirEstablecimiento' => 'Av. Amazonas N24-03, Quito',
        'contribuyenteEspecial' => '5368',
        'obligadoContabilidad' => 'SI',
        'tipoIdentificacionProveedor' => '05',
        'razonSocialProveedor' => 'María Gómez',
        'identificacionProveedor' => '1710034065',
        'direccionProveedor' => 'Calle Sucre 456, Quito',
        'totalSinImpuestos' => '50.00',
        'totalDescuento' => '0.00',
        'importeTotal' => '56.00',
        'moneda' => 'DOLAR',
        'totalConImpuestos' => [
            ['codigo' => '2', 'codigoPorcentaje' => '4', 'baseImponible' => '50.00', 'valor' => '6.00'],
        ],
        'pagos' => [
            ['formaPago' => '01', 'total' => '56.00'],
        ],
    ],
    'detalles' => [
        [
            'codigoPrincipal' => 'PROD002',
            'descripcion' => 'Compra de maíz duro',
            'cantidad' => '10.000000',
            'precioUnitario' => '5.000000',
            'descuento' => '0.00',
            'precioTotalSinImpuesto' => '50.00',
            'impuestos' => [
                ['codigo' => '2', 'codigoPorcentaje' => '4', 'tarifa' => '12.00', 'baseImponible' => '50.00', 'valor' => '6.00'],
            ],
        ],
    ],
]);

$xmlLiquidacionCompra = (new LiquidacionCompraXmlSerializer())->serialize($liquidacionCompra, $claveLiquidacionCompra);
$outPathLiquidacionCompra = __DIR__ . '/../packages/sri-ec/test/fixtures/liquidacion-compra.xml';
file_put_contents($outPathLiquidacionCompra, $xmlLiquidacionCompra);
fwrite(STDERR, "claveAcceso (liquidacionCompra): $claveLiquidacionCompra\n");
fwrite(STDERR, "Escrito: $outPathLiquidacionCompra (" . strlen($xmlLiquidacionCompra) . " bytes)\n");

// --- NotaCredito (codDoc 04) ---

$claveNotaCredito = ClaveAcceso::generar(
    fecha: '03/08/2026',
    tipoComprobante: '04',
    ruc: '1790011001001',
    ambiente: '1',
    serie: '001001',
    numero: '000000003',
    codigoNum: '12345678',
    tipoEmision: '1',
);

$notaCredito = NotaCredito::fromArray([
    'infoTributaria' => [
        'ambiente' => '1',
        'razonSocial' => 'COMERCIAL AMEPHIA S.A.',
        'ruc' => '1790011001001',
        'estab' => '001',
        'ptoEmi' => '001',
        'secuencial' => '000000003',
        'dirMatriz' => 'Av. Amazonas N24-03 y Colón, Quito',
        'tipoEmision' => '1',
    ],
    'infoNotaCredito' => [
        'fechaEmision' => '03/08/2026',
        'dirEstablecimiento' => 'Av. Amazonas N24-03, Quito',
        'tipoIdentificacionComprador' => '05',
        'razonSocialComprador' => 'Juan Pérez',
        'identificacionComprador' => '1710034065',
        'contribuyenteEspecial' => '5368',
        'obligadoContabilidad' => 'SI',
        'codDocModificado' => '01',
        'numDocModificado' => '001-001-000000001',
        'fechaEmisionDocSustento' => '01/08/2026',
        'totalSinImpuestos' => '100.00',
        'valorModificacion' => '112.00',
        'moneda' => 'DOLAR',
        'totalConImpuestos' => [
            ['codigo' => '2', 'codigoPorcentaje' => '4', 'baseImponible' => '100.00', 'valor' => '12.00'],
        ],
        'motivo' => 'Devolución de mercadería',
    ],
    'detalles' => [
        [
            'codigoPrincipal' => 'PROD001',
            'descripcion' => 'Devolución: servicio de consultoría',
            'cantidad' => '1.000000',
            'precioUnitario' => '100.000000',
            'descuento' => '0.00',
            'precioTotalSinImpuesto' => '100.00',
            'impuestos' => [
                ['codigo' => '2', 'codigoPorcentaje' => '4', 'tarifa' => '12.00', 'baseImponible' => '100.00', 'valor' => '12.00'],
            ],
        ],
    ],
]);

$xmlNotaCredito = (new NotaCreditoXmlSerializer())->serialize($notaCredito, $claveNotaCredito);
$outPathNotaCredito = __DIR__ . '/../packages/sri-ec/test/fixtures/nota-credito.xml';
file_put_contents($outPathNotaCredito, $xmlNotaCredito);
fwrite(STDERR, "claveAcceso (notaCredito): $claveNotaCredito\n");
fwrite(STDERR, "Escrito: $outPathNotaCredito (" . strlen($xmlNotaCredito) . " bytes)\n");

// --- NotaDebito (codDoc 05) ---

$claveNotaDebito = ClaveAcceso::generar(
    fecha: '03/08/2026',
    tipoComprobante: '05',
    ruc: '1790011001001',
    ambiente: '1',
    serie: '001001',
    numero: '000000004',
    codigoNum: '12345678',
    tipoEmision: '1',
);

$notaDebito = NotaDebito::fromArray([
    'infoTributaria' => [
        'ambiente' => '1',
        'razonSocial' => 'COMERCIAL AMEPHIA S.A.',
        'ruc' => '1790011001001',
        'estab' => '001',
        'ptoEmi' => '001',
        'secuencial' => '000000004',
        'dirMatriz' => 'Av. Amazonas N24-03 y Colón, Quito',
        'tipoEmision' => '1',
    ],
    'infoNotaDebito' => [
        'fechaEmision' => '03/08/2026',
        'dirEstablecimiento' => 'Av. Amazonas N24-03, Quito',
        'tipoIdentificacionComprador' => '05',
        'razonSocialComprador' => 'Juan Pérez',
        'identificacionComprador' => '1710034065',
        'contribuyenteEspecial' => '5368',
        'obligadoContabilidad' => 'SI',
        'rise' => 'Contribuyente Régimen RISE',
        'codDocModificado' => '01',
        'numDocModificado' => '001-001-000000001',
        'fechaEmisionDocSustento' => '01/08/2026',
        'totalSinImpuestos' => '100.00',
        'impuestos' => [
            ['codigo' => '2', 'codigoPorcentaje' => '4', 'baseImponible' => '100.00', 'valor' => '12.00'],
        ],
        'valorTotal' => '112.00',
        'pagos' => [
            ['formaPago' => '01', 'total' => '112.00'],
        ],
    ],
    'motivos' => [
        ['razon' => 'Intereses por mora', 'valor' => '100.00'],
    ],
]);

$xmlNotaDebito = (new NotaDebitoXmlSerializer())->serialize($notaDebito, $claveNotaDebito);
$outPathNotaDebito = __DIR__ . '/../packages/sri-ec/test/fixtures/nota-debito.xml';
file_put_contents($outPathNotaDebito, $xmlNotaDebito);
fwrite(STDERR, "claveAcceso (notaDebito): $claveNotaDebito\n");
fwrite(STDERR, "Escrito: $outPathNotaDebito (" . strlen($xmlNotaDebito) . " bytes)\n");

// --- GuiaRemision (codDoc 06) ---

$claveGuiaRemision = ClaveAcceso::generar(
    fecha: '03/08/2026',
    tipoComprobante: '06',
    ruc: '1790011001001',
    ambiente: '1',
    serie: '001001',
    numero: '000000005',
    codigoNum: '12345678',
    tipoEmision: '1',
);

$guiaRemision = GuiaRemision::fromArray([
    'infoTributaria' => [
        'ambiente' => '1',
        'razonSocial' => 'COMERCIAL AMEPHIA S.A.',
        'ruc' => '1790011001001',
        'estab' => '001',
        'ptoEmi' => '001',
        'secuencial' => '000000005',
        'dirMatriz' => 'Av. Amazonas N24-03 y Colón, Quito',
        'tipoEmision' => '1',
    ],
    'infoGuiaRemision' => [
        'dirEstablecimiento' => 'Av. Amazonas N24-03, Quito',
        'dirPartida' => 'Bodega Central, Av. Eloy Alfaro N32-100, Quito',
        'razonSocialTransportista' => 'Transportes Rápidos S.A.',
        'tipoIdentificacionTransportista' => '04',
        'rucTransportista' => '1790011001001',
        'obligadoContabilidad' => 'SI',
        'contribuyenteEspecial' => '5368',
        'fechaIniTransporte' => '03/08/2026',
        'fechaFinTransporte' => '04/08/2026',
        'placa' => 'PBX1234',
    ],
    'destinatarios' => [
        [
            'identificacionDestinatario' => '1710034065',
            'razonSocialDestinatario' => 'Juan Pérez',
            'dirDestinatario' => 'Calle Falsa 123, Quito',
            'motivoTraslado' => 'Venta',
            'codDocSustento' => '01',
            'numDocSustento' => '001-001-000000001',
            'numAutDocSustento' => '1234567890123',
            'fechaEmisionDocSustento' => '03/08/2026',
            'detalles' => [
                ['codigoInterno' => 'PROD001', 'descripcion' => 'Caja de repuestos', 'cantidad' => '5.00'],
            ],
        ],
    ],
]);

$xmlGuiaRemision = (new GuiaRemisionXmlSerializer())->serialize($guiaRemision, $claveGuiaRemision);
$outPathGuiaRemision = __DIR__ . '/../packages/sri-ec/test/fixtures/guia-remision.xml';
file_put_contents($outPathGuiaRemision, $xmlGuiaRemision);
fwrite(STDERR, "claveAcceso (guiaRemision): $claveGuiaRemision\n");
fwrite(STDERR, "Escrito: $outPathGuiaRemision (" . strlen($xmlGuiaRemision) . " bytes)\n");

// --- Retencion (codDoc 07) ---

$claveRetencion = ClaveAcceso::generar(
    fecha: '03/08/2026',
    tipoComprobante: '07',
    ruc: '1790011001001',
    ambiente: '1',
    serie: '001001',
    numero: '000000006',
    codigoNum: '12345678',
    tipoEmision: '1',
);

$retencion = Retencion::fromArray([
    'infoTributaria' => [
        'ambiente' => '1',
        'razonSocial' => 'AGENTE RETENCION S.A.',
        'ruc' => '1790011001001',
        'estab' => '001',
        'ptoEmi' => '001',
        'secuencial' => '000000006',
        'dirMatriz' => 'Av. Amazonas N24-03 y Colón, Quito',
        'tipoEmision' => '1',
    ],
    'infoCompRetencion' => [
        'fechaEmision' => '03/08/2026',
        'dirEstablecimiento' => 'Av. Amazonas N24-03, Quito',
        'contribuyenteEspecial' => '5368',
        'obligadoContabilidad' => 'SI',
        'tipoIdentificacionSujetoRetenido' => '04',
        'tipoSujetoRetenido' => '01',
        'razonSocialSujetoRetenido' => 'Proveedor EC S.A.',
        'identificacionSujetoRetenido' => '1790011002001',
        'periodoFiscal' => '08/2026',
    ],
    'docsSustento' => [
        [
            'codSustento' => '01',
            'codDocSustento' => '01',
            'numDocSustento' => '001-001-000000100',
            'fechaEmisionDocSustento' => '01/08/2026',
            'totalSinImpuestos' => '1000.00',
            'importeTotal' => '1120.00',
            'impuestosDocSustento' => [
                [
                    'codImpuestoDocSustento' => '2',
                    'codigoPorcentaje' => '4',
                    'baseImponible' => '1000.00',
                    'tarifa' => '12.00',
                    'factorProporcionalidad' => '1.00',
                    'baseImponibleModificada' => '1000.00',
                    'valorImpuesto' => '120.00',
                ],
            ],
            'retenciones' => [
                [
                    'codigo' => '2',
                    'codigoRetencion' => '303',
                    'baseImponible' => '1000.00',
                    'porcentajeRetener' => '10',
                    'valorRetenido' => '100.00',
                ],
            ],
            'pagos' => [
                ['formaPago' => '01', 'total' => '1020.00'],
            ],
        ],
    ],
]);

$xmlRetencion = (new RetencionXmlSerializer())->serialize($retencion, $claveRetencion);
$outPathRetencion = __DIR__ . '/../packages/sri-ec/test/fixtures/retencion.xml';
file_put_contents($outPathRetencion, $xmlRetencion);
fwrite(STDERR, "claveAcceso (retencion): $claveRetencion\n");
fwrite(STDERR, "Escrito: $outPathRetencion (" . strlen($xmlRetencion) . " bytes)\n");
