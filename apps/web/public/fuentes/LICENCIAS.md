# Licencias de las tipografías

El manual de marca (`docs/Manual de Marca/platise-brand-book.pdf`, p. 36) deja
esto anotado en su propia lista de pendientes:

> **Licencias tipográficas.** Fraunces, Inter e IBM Plex Mono bajo SIL Open Font
> License. **No verificado a esta fecha.** El alfabeto del logotipo es propio y
> no depende de licencia.

**Verificado el 2026-09-08, para las dos familias que este proyecto sirve.** El
texto completo de cada licencia está junto a los archivos, descargado del
repositorio oficial de cada familia:

| Familia | Archivos | Licencia | Origen del texto |
|---|---|---|---|
| **Inter** | `inter-400-latin.woff2`, `inter-400-latin-ext.woff2` | SIL Open Font License 1.1 · © 2016 The Inter Project Authors | [`rsms/inter`](https://github.com/rsms/inter/blob/master/LICENSE.txt) → `inter-OFL.txt` |
| **IBM Plex Mono** | `plex-mono-{400,500}-latin{,-ext}.woff2` | SIL Open Font License 1.1 · © 2017 IBM Corp., nombre reservado «Plex» | [`IBM/plex`](https://github.com/IBM/plex/blob/master/LICENSE.txt) → `plex-OFL.txt` |

Ambos archivos llevan la cabecera `SIL OPEN FONT LICENSE Version 1.1 - 26
February 2007`, comprobada, no supuesta.

## Lo que la OFL 1.1 exige y aquí se cumple

| Cláusula | Cómo se cumple |
|---|---|
| El aviso de copyright y la licencia viajan con los archivos | Están en esta carpeta, junto a los `.woff2` |
| Los archivos no se venden por separado | Se sirven como parte de la aplicación |
| No se usa el *Reserved Font Name* en una versión modificada | No hay modificación: son los archivos tal como los sirve Google Fonts |

Los `.woff2` son subconjuntos `latin` y `latin-ext` generados por Google Fonts.
Un subconjunto es una versión modificada a efectos de la OFL, y por eso **no se
renombran ni se redistribuyen bajo el nombre reservado como si fueran la fuente
original**: se sirven como lo que son, la misma familia recortada a los
caracteres que el español necesita.

## Fraunces no está aquí, y es a propósito

El manual la asigna al nivel **Display**, cuyo uso declarado es «Aperturas», con
tamaños de 66 a 172 px. La página de interfaz del propio manual (p. 30) fija lo
que lleva el panel operativo —cuerpo Inter de 16 px, cifras en Plex Mono— y
**Fraunces no aparece ahí**. La aplicación no tiene aperturas: tiene pantallas
de trabajo.

Servir una familia de 124 kB para usarla en un tamaño que el manual no contempla
sería inventar un valor, que es justo lo que `CLAUDE.md` §10 prohíbe. Está
razonado en `docs/pasos/P14/CONSTRUCCION.md`.
