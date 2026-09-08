# Imagen de produccion del frontend — multi-stage.
#
# MISMO DIGEST QUE LA API, a proposito. Una imagen fijada por digest y no por
# etiqueta (CLAUDE.md §1, regla `sin-imagen-sin-fijar` de audit:forbidden), y la
# MISMA para los dos servicios: dos versiones de Node en la misma maquina son
# dos superficies que parchear y dos comportamientos que diferir.
#
# Corresponde a Node 24.19.0, que es lo que la imagen oficial publica; `engines`
# pide `>=24.19.0 <25.0.0` justamente por eso. Subir el digest es un cambio
# deliberado, y se sube en los dos Dockerfile a la vez.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

# ---------------------------------------------------------------------------
# Etapa 1 — construccion
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /app
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

# Los manifiestos primero: mientras las dependencias no cambien, Docker reutiliza
# la capa de `npm ci`, que es la cara. Hacen falta los DOS workspaces porque
# `npm ci` valida el arbol entero contra `package-lock.json`; si falta uno, se
# queja de que el lock no corresponde.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# `--ignore-scripts` NO es un atajo: es lo que hace que esta imagen no necesite
# saber nada de la API.
#
# El `prepare` de la raiz activa los hooks de git y genera el cliente de Prisma,
# y lo segundo exige tener el esquema presente. Los cinco scripts de instalacion
# que `allowScripts` permite —prisma, @prisma/engines, argon2, @swc/core,
# esbuild— son todos del backend. El frontend no usa ninguno: Next trae sus
# binarios como dependencias opcionales normales, sin script.
#
# Saltarselos deja el build del frontend independiente del backend, que es lo
# correcto: son dos artefactos y se despliegan por separado.
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/web/ apps/web/

# LA URL DE LA API SE HORNEA AQUI, Y HAY QUE SABERLO.
#
# `NEXT_PUBLIC_*` no es una variable de entorno de ejecucion: Next la sustituye
# por su valor DENTRO del paquete que viaja al navegador, en tiempo de build.
# Ponerla en el `environment:` del compose no hace nada — el valor ya esta
# escrito en el JavaScript servido.
#
# El valor por defecto es una RUTA RELATIVA, `/api`, y eso es deliberado: hace
# que la imagen no dependa del dominio. La misma imagen sirve para
# `platise.ec`, para un dominio de pruebas y para localhost, porque el navegador
# pide `/api/...` al mismo origen del que descargo la pagina.
#
# Y esa es la razon de que NO haga falta CORS: sin peticion cruzada no hay nada
# que permitir, y `CORS_ORIGENES` puede quedarse vacio, que es su valor mas
# restrictivo. Ver `docker/caddy/Caddyfile`.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build --workspace @costeo/web

# ---------------------------------------------------------------------------
# Etapa 2 — ejecucion
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# `output: 'standalone'` deja en `.next/standalone` un servidor propio con solo
# las dependencias que de verdad se ejecutan. Por eso aqui NO se copia
# `node_modules` del workspace: ya viene dentro.
COPY --from=build /app/apps/web/.next/standalone ./

# ESTAS DOS COPIAS SON OBLIGATORIAS Y SU AUSENCIA NO SE NOTA AL ARRANCAR.
#
# `standalone` NO incluye ni `.next/static` ni `public/`. Sin ellas el servidor
# levanta igual, la pagina responde 200 y lo que falla son los recursos: la hoja
# de estilos, las tipografias autoalojadas y los dos SVG de la marca.
#
# El sintoma es cruel porque es parcial: sin `tipografia.css` la aplicacion se
# ve, solo que con otra letra, y eso no se nota hasta que alguien mira de cerca.
# Sin `public/marca/` el logotipo es un icono roto. Hay una comprobacion de esto
# en `docs/runbooks/despliegue.md`, y no es opcional.
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Usuario sin privilegios, que la imagen oficial ya trae creado (SEGURIDAD.md §9).
USER node

EXPOSE 3001

# `HOSTNAME` no es cosmetico: el servidor de `standalone` escucha en `localhost`
# si no se le dice otra cosa, y desde fuera del contenedor eso es inalcanzable.
# El sintoma es un `connection refused` desde Caddy con el contenedor sano.
ENV HOSTNAME=0.0.0.0
ENV PORT=3001

# Sin `npm start` de por medio, por lo mismo que en la API: `npm` entre el init y
# el proceso se traga las senales y SIGTERM nunca llega a Node.
CMD ["node", "apps/web/server.js"]
