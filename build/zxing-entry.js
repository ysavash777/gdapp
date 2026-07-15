/* ============================================================
   Punto de entrada para empaquetar el motor ZXing (usado por el
   motor de escaneo de iOS Safari) en un único archivo ESM sin
   dependencias externas, listo para servirse como estático.
   Ver scripts.build:zxing en package.json — el resultado se comitea
   en public/shared/js/vendor/zxing.bundle.js, no se genera en cada
   arranque (este proyecto no tiene paso de build para el resto de
   la app).
   ============================================================ */
export { BrowserMultiFormatReader, BrowserCodeReader } from '@zxing/browser';
export { DecodeHintType, BarcodeFormat, NotFoundException } from '@zxing/library';
