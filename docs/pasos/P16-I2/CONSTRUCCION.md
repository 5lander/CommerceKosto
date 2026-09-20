# P16-I2 — La regla del doble intérprete, la base en limpio y D-16.202 registrada

> Tres cosas pedidas antes de la pantalla 15, y una decisión anotada para P16-J.

## 1 · CLAUDE.md §3 — la regla se generaliza

La regla de P16-I hablaba solo de Python y de `\b`. La causa real es más ancha: **el contenido
atraviesa dos intérpretes** y el primero se come lo que el segundo necesitaba. Tres casos, tres
lenguajes:

| Qué pasó | Qué se comió el primer intérprete |
|---|---|
| **INC-007, casos 7, 8 y 14** | `\b` en una cadena normal de Python es el **retroceso** (0x08). La regex compila, no lanza y **no casa nunca** |
| **P16-I** | Los backticks de un Markdown dentro de `node -e "…"` los ejecutó **bash** como sustitución de comandos: el archivo quedó con huecos donde iban los nombres |
| **P16-H** | `-m @'…'@` es un *here-string* de PowerShell; en bash son dos `@` pegados, y el commit salió con una arroba en el asunto |

**Regla nueva:** el contenido de archivos y de mensajes se escribe con la herramienta de escritura o
desde un archivo (`-F`); nunca incrustado en un comando de shell. Si hace falta generarlo con un
script, **que el script escriba el archivo** — no que el shell lo transporte.

Y se aplicó en este mismo paquete: los dos cambios de `ESTADO.md` los hizo un `.mjs` que escribe el
archivo, no un `node -e` en la línea de comandos.

## 2 · La base de desarrollo, en limpio

Decisión del usuario, ejecutada:

| | Antes | Después |
|---|---|---|
| `costeo` | **12 GB · 34.411.467 movimientos** | **15 MB** |
| `costeo_restaurado` (la auxiliar del simulacro) | ~10 GB | **eliminada** |

`npm run db:reset -- --si` vacía las tablas y **reaplica las 22 migraciones**, así que de paso
vuelve a ejercitar la ida completa sobre una base vacía.

### El entorno sintético, reconstruido

| | `ensayo` | `ensayo-b` |
|---|---|---|
| Ubicaciones | Local Centro · Bodega Norte | Local Centro · Bodega Norte *(mismos nombres a propósito — D-16.193)* |
| Ítems | 5 (Aceite de girasol, Arroz, Camarón pelado, Cebolla paiteña, Limón sutil) | 2 (Arroz, Camarón pelado) |
| Productos | 2 (Arroz marinero, Ceviche mixto) | 1 (**Arroz marinero**, el mismo nombre, otro PVP) |

`seed:tenant` para las dos companies, `npm run importar` con los CSV sintéticos para «ensayo» y
`poblar-ensayo-b.mjs` para la segunda.

> **Lo que no volvió, y es correcto que no vuelva:** los ítems y productos que se crearon *a mano*
> verificando las pantallas 5–14, y el libro que sembró el simulacro de D-16.198. Eran artefactos de
> verificación, no el entorno. Lo que el entorno necesita —dos companies con los mismos nombres y
> cifras distintas— está entero.

### Y los UUID escritos a mano, resueltos por nombre

El reset dejó **21 guiones del scratchpad** apuntando a filas que ya no existen. Un UUID caduco no
da un error claro: da un **404 que parece un fallo de la pantalla**.

- **`ids.mjs`** resuelve ubicaciones, ítems y productos **por nombre** contra la API, y falla
  ruidosamente si el nombre no está, diciendo cuáles hay. Los nombres son estables por diseño
  (D-16.193 exige que las dos companies se llamen igual); el id es lo que no se escribe nunca.
- `poblar-ensayo-b.mjs` ya lo usa.
- Los otros 20 son el registro de verificaciones ya hechas y **no se reescriben** —reescribir un
  registro es peor que dejarlo viejo—, pero llevan un aviso arriba para que nadie los relance a
  ciegas.

## 3 · D-16.202 registrada, y una cuenta que no cuadra

La duda #16 queda **decidida: opción (a) extendida**, y se construye como **P16-J, inmediatamente
antes de la pantalla 25**. La decisión está entera en `ESTADO.md`.

**Pero el enunciado trae una cuenta que no sale sobre el dataset de CC-011**, y se anota antes de
construir nada:

```
consumo_real = 40 (inicial) + 100 (compras) − 20 (transferencia enviada)
             − 8 (salida a producción) − 86 (final físico)           = 26,00
varianza     = 26,00 − 22,00 (teórico)                               =  4,00
```

El enunciado dice **4,50 = 2,50 merma + 2,00 no atribuible**. La diferencia es el **`AJUSTE` de
+0,5 kg** del mes, que resta de la varianza y no aparece en ese desglose. Con él, hay dos formas
coherentes de presentarlo, y son una decisión de producto:

| | Desglose | Qué implica |
|---|---|---|
| (i) | `4,00 = 2,50 merma + 1,50 no atribuible` | El ajuste vive **dentro** de «no atribuible» |
| (ii) | `4,00 = 2,50 merma − 0,50 ajuste + 2,00 no atribuible` | El ajuste es **su propia línea**, como la merma |

Queda en la decisión, para confirmarlo al construir P16-J.
