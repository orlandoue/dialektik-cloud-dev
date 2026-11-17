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
| Borde de controles (botones secundarios, chips, campos, «Elegir otro estudio») | `borderControl` #858D9A / `surface` #FFFFFF | 3.35:1 | ✓ (mín. 3.0) |
| Borde de controles sobre el fondo de la app | `borderControl` #858D9A / `bgApp` #F6F6F9 | 3.10:1 | ✓ (mín. 3.0) |
| Chip de relación cerrado (estudio retractado o sin resumen) | `inkSecondary` #4B5563 / `bgApp` #F6F6F9 | 7.01:1 | ✓ |
| Estado en «Tus comentarios» (Publicado, En revisión, Oculto) | `tagText` #374151 / `tagBg` #F1F2F4 | 9.20:1 | ✓ |
| «Selecciona al menos 6 palabras o 40 caracteres…» | `ink` #111827 / `surface` #FFFFFF | 17.74:1 | ✓ |

`borderControl` pasó de #D1D5DB (1.47:1) a #858D9A en todos los controles: cumple 1.4.11 sobre blanco y sobre #F6F6F9. Los goldens de `test/science/goldens/` se regeneraron con el nuevo gris. El chip cerrado usa el borde de tarjeta (#E5E7EB): un control deshabilitado está exento de 1.4.11, y su texto sí cumple.
