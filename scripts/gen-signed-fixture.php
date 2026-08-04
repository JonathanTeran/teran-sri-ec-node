<?php

declare(strict_types=1);

/**
 * Genera el fixture dorado de la FIRMA XAdES-BES: firma
 * `packages/sri-ec/test/fixtures/factura.xml` con
 * `packages/sri-ec/test/fixtures/test-cert.p12` usando el `XadesSigner` REAL
 * del paquete PHP `teran-sri-ec`, y escribe el resultado en
 * `packages/sri-ec/test/fixtures/factura-signed-php.xml`.
 *
 * El reloj es FIJO (`FIXED_INSTANT`) para que la salida sea determinista:
 * el sufijo de los IDs de la firma se deriva de sha1(fechaFirma . certPem),
 * así que con reloj fijo + mismo .p12 el fixture es byte-a-byte reproducible.
 *
 * Uso:
 *   php scripts/gen-signed-fixture.php
 *
 * Requiere que el paquete PHP hermano tenga `composer install` corrido
 * (vendor/autoload.php presente).
 */

require '/Users/jonathanteran/desarrollo/paquetes/teran-sri-ec/vendor/autoload.php';

use Teran\Sri\Signing\CertificateLoader;
use Teran\Sri\Signing\ClockInterface;
use Teran\Sri\Signing\SignatureOptions;
use Teran\Sri\Signing\XadesSigner;

/** Instante de firma fijo (mismo que usa `test/xades-signer.test.ts`). */
const FIXED_INSTANT = '2026-08-03T12:34:56-05:00';

final class FixedClock implements ClockInterface
{
    public function __construct(private readonly \DateTimeImmutable $instant)
    {
    }

    public function now(): \DateTimeImmutable
    {
        return $this->instant;
    }
}

$fixtures = __DIR__ . '/../packages/sri-ec/test/fixtures';

$p12 = file_get_contents($fixtures . '/test-cert.p12');
if ($p12 === false) {
    fwrite(STDERR, "No se pudo leer test-cert.p12\n");
    exit(1);
}

$cert = (new CertificateLoader())->load($p12, 'test1234');

$signer = new XadesSigner(
    new SignatureOptions(),
    new FixedClock(new \DateTimeImmutable(FIXED_INSTANT)),
);

/**
 * Entradas a firmar: la factura dorada y un documento con los casos límite de
 * canonicalización/serialización (entidades, CDATA, comentarios, elementos
 * vacíos, `xml:space`, contenido mixto, atributos con caracteres especiales).
 * El segundo existe para verificar que la C14N y el serializador de TS se
 * comportan igual que libxml también fuera del camino feliz.
 */
$documents = [
    'factura.xml' => 'factura-signed-php.xml',
    'c14n-edge-cases.xml' => 'c14n-edge-cases-signed-php.xml',
    // Raíz con atributos `xml:*`: la C14N de un SUBÁRBOL (SignedInfo,
    // SignedProperties) debe heredarlos al nodo ápice (C14N 1.0 §2.2), o la
    // firma no valida contra libxml/OpenSSL.
    'factura-xml-lang.xml' => 'factura-xml-lang-signed-php.xml',
];

foreach ($documents as $input => $output) {
    $unsigned = file_get_contents($fixtures . '/' . $input);
    if ($unsigned === false) {
        fwrite(STDERR, "No se pudo leer $input\n");
        exit(1);
    }

    $signed = $signer->sign($unsigned, $cert);

    $outPath = $fixtures . '/' . $output;
    file_put_contents($outPath, $signed);

    fwrite(STDERR, "Escrito: $outPath (" . strlen($signed) . " bytes)\n");
}

fwrite(STDERR, "SigningTime: " . FIXED_INSTANT . "\n");
