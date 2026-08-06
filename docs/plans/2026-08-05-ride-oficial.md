# RIDE conforme al Anexo 2 oficial del SRI — Plan

**Goal:** Rehacer el layout del RIDE para que reproduzca las maquetas oficiales
del **Anexo 2** de la Ficha Técnica del SRI, en lugar del diseño propio que
salió de la lista de campos.

**Fuente normativa:** `ficha-tecnica-sri.pdf` (copia local en el scratchpad de
la sesión; también en sri.gob.ec). El Anexo 2 ocupa las **páginas 56 a 61** del
PDF, una maqueta por comprobante:

| Página | Comprobante |
|--------|-------------|
| 56 | Factura |
| 57 | Nota de crédito |
| 58 | Nota de débito |
| 59 | Comprobante de retención |
| 60 | Guía de remisión |
| 61 | Liquidación de compra |

**Todo implementador debe LEER esas páginas como imágenes** (la herramienta Read
acepta PDFs con el parámetro `pages`) antes de tocar código. Las maquetas son
la especificación; este documento solo resume lo que hay que ver en ellas.

## Cambios de fondo respecto al RIDE actual (v0.2.0)

1. **Código de barras Code128, no QR.** El Anexo 2 muestra un código de barras
   bajo el rótulo `CLAVE DE ACCESO`, con los 49 dígitos impresos debajo. La nota
   al pie de la página 56 dice literalmente: *"Conforme consta en el numeral
   8.20, el código de barras es opcional."* — o sea que es opcional, pero cuando
   se imprime es de barras. Mantener el QR como opción alternativa.
2. **Bloque inferior en dos columnas.** Izquierda: caja `Información Adicional`
   y debajo la tabla `Forma de Pago | Valor`. Derecha: la tabla de totales.
   Hoy están apilados a lo ancho.
3. **Etiquetas y orden fijos de la tabla de totales** (ver abajo).
4. **Nombre del documento con espaciado entre letras** (`F A C T U R A`).
5. **Tres columnas `Detalle Adicional`** en la tabla de detalles de factura.

## Estructura común (todos los comprobantes)

**Cabecera, dos columnas:**

- *Izquierda*: logo del emisor arriba (opcional, ocupa un recuadro amplio), y
  debajo una caja con borde: razón social, nombre comercial, `Dirección
  Matriz:`, `Dirección Sucursal:`, `Contribuyente Especial Nro` (valor alineado
  a la derecha), `OBLIGADO A LLEVAR CONTABILIDAD` + `SI`/`NO`.
- *Derecha*, caja con borde: `R.U.C.:`, nombre del documento espaciado, `No.` +
  `estab-ptoEmi-secuencial`, `NÚMERO DE AUTORIZACIÓN` con el número debajo,
  `FECHA Y HORA DE AUTORIZACIÓN`, `AMBIENTE:`, `EMISIÓN:`, `CLAVE DE ACCESO` +
  código de barras + los 49 dígitos debajo.

**Banda del sujeto** (ancho completo, con borde). Varía por tipo — ver maquetas.

**Tabla de detalles.** Encabezados exactos por tipo — ver maquetas.

**Pie, dos columnas:** `Información Adicional` + `Forma de Pago` a la izquierda;
totales a la derecha.

## Tabla de totales — etiquetas y orden exactos

Factura (página 56):

```
SUBTOTAL 15%                  ← el porcentaje sale del código de tarifa, no fijo
SUBTOTAL IVA 0%
SUBTOTAL NO OBJETO IVA
SUBTOTAL EXENTO IVA
SUBTOTAL SIN IMPUESTOS
DESCUENTO
ICE
IVA 15%                       ← idem, dinámico
IRBPNR
PROPINA
VALOR TOTAL
VALOR TOTAL SIN SUBSIDIO
AHORRO POR SUBSIDIO (incluye IVA cuando corresponda)
```

Liquidación de compra (página 61): `SUBTOTAL 15%`, `SUBTOTAL 0%`, `SUBTOTAL NO
OBJETO DE IVA`, `SUBTOTAL EXENTO DE IVA`, `SUBTOTAL SIN IMPUESTOS`, `TOTAL
DESCUENTO`, `ICE`, `IVA 15%`, `IRBPNR`, `VALOR TOTAL`.

Nota de crédito y nota de débito: como factura pero sin propina ni subsidios.

Retención y guía de remisión: **no llevan bloque de totales**.

> Las maquetas oficiales son de 2017 y dicen `12%`. El IVA vigente es del 15%,
> así que el porcentaje debe derivarse del `codigoPorcentaje` del documento, no
> escribirse fijo. Mantener el comportamiento actual en ese punto.

## Particularidades por comprobante

**Nota de crédito** (p57): tras la banda del comprador, `Comprobante que se
modifica` + tipo + número, `Fecha Emisión (Comprobante a modificar)`, `Razón de
Modificación:`.

**Nota de débito** (p58): igual, y además una banda de dos columnas con los
encabezados `RAZÓN DE LA MODIFICACIÓN` | `VALOR DE LA MODIFICACIÓN`.

**Retención** (p59): tabla con encabezados `Comprobante`, `Número`, `Fecha
Emisión`, `Ejercicio Fiscal`, `Base Imponible para la Retención`, `IMPUESTO`,
`Porcentaje Retención`, `Valor Retenido`. Sin totales.

**Guía de remisión** (p60): banda del transportista con `Identificación
(Transportista)`, `Razón Social / Nombres y Apellidos:`, `Placa:`, `Punto de
Partida:`, `Fecha inicio Transporte`, `Fecha fin Transporte`. Luego, por cada
destinatario: `Comprobante de Venta:` + tipo + número + `Fecha de Emisión:`,
`Número de Autorización:`, `Motivo Traslado:`, `Destino(Punto de llegada)`,
`Identificación (Destinatario)`, `Razón Social/Nombres Apellidos`, `Documento
Aduanero`, `Código Establecimiento Destino`, `Ruta:`, y su tabla con columnas
`Cantidad`, `Descripcion`, `Código Principal`, `Código Auxiliar`.

**Liquidación de compra** (p61): banda con `Nombres y Apellidos:`,
`Identificación:`, `Fecha Emision:`, `Dirección:`.

---

### Tarea 1 — Cabecera, pie y factura

Rehacer en `packages/sri-ec/src/ride/blocks.ts` los bloques compartidos para que
reproduzcan la maqueta (cabecera de dos columnas, banda del sujeto, pie de dos
columnas con totales a la derecha), añadir el código de barras Code128, y
adaptar `factura.ride.ts`.

- [ ] Leer las páginas 56 y 61 del PDF antes de escribir código.
- [ ] Code128 sin dependencias nativas. Evaluar `bwip-js` (JS puro) o generar el
      patrón de barras a mano y dibujarlo con rectángulos de pdfkit — esto
      último evita otra dependencia y Code128 es sencillo de codificar. Decidir
      y justificar en el reporte. La dependencia, si la hay, va como opcional
      junto a pdfkit/qrcode.
- [ ] `OpcionesFormatoRide` gana `codigoBarras?: boolean` (default `true`, como
      la maqueta) y conserva `incluirQr` para quien lo prefiera.
- [ ] No regresar ninguna corrección previa: medir-antes-de-dibujar, cajas que
      no cruzan de página, `instanceof` en CJS, campos fiscales completos,
      columna `Cant.` que no parte números.
- [ ] Tests: extraer texto y aserciones sobre las etiquetas oficiales exactas de
      la tabla de totales y de la cabecera; verificar que el código de barras se
      dibuja (contar rectángulos en la región esperada).
- [ ] Commit `feat(ride): cabecera, pie y factura conforme al Anexo 2 del SRI`.

### Tarea 2 — Los otros cinco comprobantes

- [ ] Leer las páginas 57 a 61 antes de escribir código.
- [ ] Adaptar cada renderizador a su maqueta, con las etiquetas literales.
- [ ] Un test por tipo aserta las etiquetas propias de ese comprobante.
- [ ] Commit `feat(ride): los 6 comprobantes conforme al Anexo 2 del SRI`.

### Tarea 3 — Publicar 0.3.0

- [ ] README: mencionar que el RIDE sigue el Anexo 2 y que el código de barras
      es el predeterminado.
- [ ] Subir versión de ambos paquetes, tag, publicar, release en GitHub.
