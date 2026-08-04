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
use Teran\Sri\Utils\ClaveAcceso;
use Teran\Sri\Xml\FacturaXmlSerializer;

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
