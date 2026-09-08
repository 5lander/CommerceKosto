# Imagen de produccion de la API — multi-stage.
#
# IMAGEN FIJADA POR DIGEST, nunca por etiqueta (CLAUDE.md §1). Una etiqueta es
# un puntero movil: `node:24-bookworm-slim` apunta hoy a una imagen y manana a
# otra, y la reconstruccion de una version antigua deja de ser reproducible. Lo
# verifica la regla `sin-imagen-sin-fijar` de audit:forbidden.
#
# Este digest corresponde a **Node 24.19.0**, no a 24.20.0. La imagen oficial va
# por detras del ultimo parche publicado (ADR-001 fijo 24.20.0 el 2026-08-26).
# `engines` del proyecto pide `>=24.19.0 <25.0.0` justamente por esto: el rango
# lo cumple, y subir el digest es un cambio deliberado, no un efecto secundario.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

# ---------------------------------------------------------------------------
# Etapa 1 — construccion
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /app
ENV CI=true

# Los manifiestos primero, y el codigo despues: mientras las dependencias no
# cambien, Docker reutiliza la capa de `npm ci`, que es la cara.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/

# `prepare` corre en cada `npm ci` y hace dos cosas: activar los hooks de git
# —que aqui no aplica y el propio script detecta— y generar el cliente de
# Prisma, que si necesita el esquema presente antes de instalar.
COPY tools/setup-hooks.mjs tools/
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma

RUN npm ci

COPY tsconfig.base.json ./
# `tsconfig.ui.json` tambien: desde P13 el build emite ademas `dist/ui/`, el
# guion del back office. Sin el, `npm run build` falla dentro de la imagen.
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/tsconfig.ui.json apps/api/

# EL PARSER, QUE VIVE FUERA DE `src/` Y HAY QUE COPIARLO APARTE.
#
# `apps/api/parser/` son tres archivos `.mjs`/`.d.mts` que P10 dejo fuera del
# arbol de TypeScript a proposito (ADR-013): Node exige extension explicita para
# ejecutar TS como ESM, y este paquete es CommonJS con imports sin extension, asi
# que el hijo que se forkea tiene que ser `.mjs` de verdad.
#
# **SIN ESTA LINEA LA IMAGEN NO COMPILA**, porque `imports/infrastructure/
# limites.ts` importa el tipo `LimitesDelZip` de `parser/lector.mjs`. Y falto
# desde P10: la imagen llevaba dos dias sin poder construirse y nadie lo vio
# porque nadie la construyo. Ver INC-018.
COPY apps/api/parser apps/api/parser

COPY apps/api/src apps/api/src

RUN npm run build --workspace @costeo/api

# Fuera todo lo que solo servia para construir. Se hace aqui y no reinstalando
# en la etapa siguiente porque `npm ci --omit=dev` volveria a ejecutar
# `prepare`, que necesita el CLI de Prisma, que es precisamente una devDependency.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Etapa 2 — ejecucion
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/generated apps/api/generated

# El parser tambien EN EJECUCION, no solo para compilar: `leer-en-hijo.ts` lo
# forkea buscando `parser/hijo.mjs` desde la carpeta que tiene el `package.json`.
# Sin el, importar un archivo falla en caliente y no al arrancar.
COPY --from=build /app/apps/api/parser apps/api/parser

# Usuario sin privilegios, que la imagen oficial ya trae creado. Un proceso que
# corre como root dentro del contenedor convierte cualquier ejecucion remota de
# codigo en control del contenedor entero (SEGURIDAD.md §9).
USER node

EXPOSE 3000

# Sin `npm start` de por medio: `npm` entre el init y el proceso se traga las
# senales, y entonces SIGTERM no llega a Node y el cierre ordenado —cerrar el
# pool de PostgreSQL— nunca ocurre. Se ejecuta el proceso directamente.
CMD ["node", "apps/api/dist/main.js"]
