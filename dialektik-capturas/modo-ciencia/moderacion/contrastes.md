# Contrastes · moderación, reportes y estudios sin resumen

WCAG 2.2: 4.5:1 para texto normal y 3:1 para componentes que no son texto.

| Elemento | Texto / fondo | Contraste | AA |
|---|---|---|---|
| Cuerpo de comentarios, motivos, campos | `ink` #111827 / `surface` #FFFFFF | 17.74:1 | ✓ |
| Texto de tarjetas sobre el fondo de la app | `ink` #111827 / `bgApp` #F6F6F9 | 16.45:1 | ✓ |
| Meta, ayuda, reportes, consumo día a día | `inkSecondary` #4B5563 / `surface` #FFFFFF | 7.56:1 | ✓ |
| «Este estudio no tiene resumen disponible» | `ink` #111827 / `bgApp` #F6F6F9 | 16.45:1 | ✓ |
| Enlaces «Ver ficha», «Completar estudio», pestaña activa | `primaryText` #4C33D9 / `surface` #FFFFFF | 7.55:1 | ✓ |
| Botones «Aprobar», «Ocultar», «Enviar reporte», «Guardar» | `white` #FFFFFF / `primary` #5B3FF5 | 6.04:1 | ✓ |
| Opción elegida en «Reportar» | `white` #FFFFFF / `ink` #111827 | 17.74:1 | ✓ |
| Opción sin elegir en «Reportar» | `ink` #111827 / `surface` #FFFFFF | 17.74:1 | ✓ |
| Pestaña inactiva «Consumo de APIs» | `inkSecondary` #4B5563 / `surface` #FFFFFF | 7.56:1 | ✓ |
| Etiqueta «En revisión» | `tagText` #374151 / `tagBg` #F1F2F4 | 9.20:1 | ✓ |
| Ícono «Más opciones» (…) | `inkSecondary` #4B5563 / `surface` #FFFFFF | 7.56:1 | ✓ |
| Borde de «Rechazar» / «Descartar reportes» | `borderControl` #D1D5DB / `surface` #FFFFFF | 1.47:1 | ✗ (mín. 3.0) |

El borde de los botones secundarios (`borderControl`, 1.47:1) queda bajo 3:1. Es el mismo token que ya había quedado señalado en C1–C4. Los botones se identifican por su texto, que sí cumple, pero si quieres cumplir 1.4.11 en el borde, `#6B7280` da 4.83:1.
