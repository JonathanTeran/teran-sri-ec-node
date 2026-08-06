# Changelog

Todas las versiones siguen [SemVer](https://semver.org/lang/es/). Formato
inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).
Cubre ambos paquetes del monorepo (`sri-ec` y `sri-ec-nestjs`), que se versionan
juntos.

## [0.3.0] - 2026-08-06

### Added

- RIDE rehecho para reproducir la maqueta oficial del **Anexo 2 de la Ficha
  Técnica del SRI** en los 6 comprobantes: cabecera de dos columnas, banda del
  sujeto, tabla de detalles y pie con totales, con las etiquetas y el orden
  exactos de cada maqueta (páginas 56-61 del Anexo 2).
- Código de barras **Code 128** de la clave de acceso, codificado e impreso a
  mano con `pdfkit` (sin dependencias nuevas), bajo el rótulo `CLAVE DE
  ACCESO` — lo que muestra la maqueta oficial.
- `OpcionesFormatoRide.codigoBarras` (`boolean`, default `true`).

### Changed

- **`incluirQr` pasa de `true` a `false` por defecto** en los 6
  renderizadores del RIDE (`generarRide`/`generarRideFactura`/etc.): el
  código de barras Code 128 es ahora el predeterminado, conforme al Anexo 2.
  Quien actualice desde 0.2.0 y quiera seguir generando el QR debe pasar
  `opciones: { incluirQr: true }` explícitamente.
- `sri-ec-nestjs`: `peerDependencies.sri-ec` sube a `^0.3.0`.

## [0.2.0] - 2026-08-05

### Added

- RIDE (PDF + QR) de los 6 comprobantes (Factura, Liquidación de Compra,
  Notas de Crédito/Débito, Guía de Remisión, Retención) vía el subpath
  opcional `sri-ec/ride`; `pdfkit`/`qrcode` como `peerDependencies` opcionales
  que el consumidor instala solo si genera el RIDE.

### Fixed

- Medir antes de dibujar: las cajas del RIDE ya no cruzan de página con alto
  negativo.
- Columnas de tabla que partían valores/encabezados a la mitad (incluida la
  columna `Cant.` tras un fix de precisión anterior).
- Campos fiscales reales del documento que el RIDE perdía silenciosamente
  (auditoría previa al release).
- `dirEstablecimiento` / `contribuyenteEspecial` / `dirMatriz` sin el tope de
  longitud arbitrario heredado del XSD.
- `instanceof SriError` era `false` en CommonJS entre `sri-ec` y `sri-ec/ride`.
- `optionalDependencies` instalaba `pdfkit`/`qrcode` para todo el mundo, no
  solo para quien usa el RIDE (se pasó a `peerDependencies` opcionales).

## [0.1.0] - 2026-08-04

### Added

- Port inicial Node.js/TypeScript de [`amephia/sri-ec`](https://packagist.org/packages/amephia/sri-ec)
  (PHP): tipos de los 6 comprobantes electrónicos, catálogos, clave de acceso
  (Módulo 11) y utilidades de montos decimal-seguros.
- Validación estructural (zod) y de negocio (`BusinessValidator`: coherencia
  aritmética de totales, impuestos agregados y retenciones).
- Serializadores XML por comprobante con golden fixtures.
- Carga de certificados `.p12`/`.pfx` con `node-forge` (sin dependencias
  nativas, soporta cifrado legacy pre-2024) y firma **XAdES-BES** verificada
  byte a byte contra el paquete PHP original.
- Transporte SOAP nativo sobre `fetch`, `SriClient` (emisión individual) y
  `BatchEmitter` (envío masivo con reintentos y backoff configurable).
- Validación de RUC: local, checksum estricto opt-in y verificación online
  con fallback.
- Módulo `sri-ec-nestjs` con el patrón `forRoot()`/`forRootAsync()` estándar
  del ecosistema Nest.

[0.3.0]: https://github.com/JonathanTeran/teran-sri-ec-node/releases/tag/v0.3.0
[0.2.0]: https://github.com/JonathanTeran/teran-sri-ec-node/releases/tag/v0.2.0
[0.1.0]: https://github.com/JonathanTeran/teran-sri-ec-node/releases/tag/v0.1.0
