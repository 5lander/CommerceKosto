/**
 * La página del back office: el armazón HTML y su hoja de estilos.
 *
 * **NADA VA EN LÍNEA, y no es estética: es la Content-Security-Policy.** El
 * proceso emite `script-src 'self'` y `style-src 'self' 'nonce-…'`, así que un
 * `<script>` o un `style=` dentro del HTML no se ejecutaría — o exigiría
 * repartir el nonce por la plantilla. Sirviendo el JS y el CSS como dos
 * recursos propios, la CSP los acepta sin excepciones y sin nonce.
 *
 * **LOS ESTILOS SON TOKENS, no valores sueltos por componente** (CLAUDE.md §10).
 * El bloque `:root` de abajo es el único sitio donde hay un color o un tamaño;
 * todo lo demás los referencia. Que la capa visual sea reemplazable sin tocar
 * lógica vale también aquí, aunque el back office no tenga requisitos estéticos.
 *
 * **NO SE APLICA LA MARCA** (`docs/Manual de Marca/…`). Eso es P14 y es para la
 * app cliente; el back office es interno y sobrio a propósito.
 */

/** Un armazón vacío: todo lo pinta `dist/ui/backoffice.js`. */
export const HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Back office · costeo-saas</title>
<link rel="stylesheet" href="/ui/estilos.css">
</head>
<body>
<main id="raiz" aria-live="polite">
  <p class="cargando">Cargando…</p>
</main>
<script type="module" src="/ui/app.js"></script>
</body>
</html>
`;

export const CSS = `/* Los tokens. El unico sitio con un color o un tamano. */
:root {
  --fondo: #10131a;
  --superficie: #171b24;
  --superficie-alta: #1e2430;
  --borde: #2a3140;
  --texto: #e6e9ef;
  --texto-suave: #9aa4b6;
  --texto-tenue: #6b7688;
  --acento: #5b8def;
  --bien: #3fae7a;
  --atencion: #d9a33a;
  --mal: #d9534f;

  --espacio-1: 4px;
  --espacio-2: 8px;
  --espacio-3: 12px;
  --espacio-4: 16px;
  --espacio-6: 24px;
  --espacio-8: 32px;

  --texto-xs: 12px;
  --texto-sm: 13px;
  --texto-md: 15px;
  --texto-lg: 18px;
  --texto-xl: 24px;

  --radio: 6px;
  --ancho-maximo: 1100px;

  --tipo: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--fondo);
  color: var(--texto);
  font: var(--texto-md) / 1.5 var(--tipo);
}

main { max-width: var(--ancho-maximo); margin: 0 auto; padding: var(--espacio-6); }

h1 { font-size: var(--texto-xl); margin: 0; }
h2 { font-size: var(--texto-lg); margin: var(--espacio-6) 0 var(--espacio-3); }

a { color: var(--acento); }

.cabecera {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: var(--espacio-4); flex-wrap: wrap; margin-bottom: var(--espacio-6);
}
.cabecera .quien { color: var(--texto-suave); font-size: var(--texto-sm); }

.aviso {
  border: 1px solid var(--borde); border-left: 3px solid var(--atencion);
  background: var(--superficie); border-radius: var(--radio);
  padding: var(--espacio-3) var(--espacio-4); margin-bottom: var(--espacio-6);
}
.aviso p { margin: 0 0 var(--espacio-2); color: var(--texto-suave); font-size: var(--texto-sm); }
.aviso .cuenta { color: var(--texto-tenue); font-size: var(--texto-xs); }
.aviso .cuenta.falta { color: var(--atencion); }

label { display: block; color: var(--texto-suave); font-size: var(--texto-sm); margin-bottom: var(--espacio-1); }

input, select, textarea, button {
  font: inherit; color: var(--texto);
  background: var(--superficie-alta); border: 1px solid var(--borde);
  border-radius: var(--radio); padding: var(--espacio-2) var(--espacio-3);
}
input, textarea { width: 100%; }
textarea { resize: vertical; min-height: 52px; }
input:focus, select:focus, textarea:focus, button:focus-visible {
  outline: 2px solid var(--acento); outline-offset: 1px;
}

button { cursor: pointer; }
button[disabled] { opacity: 0.5; cursor: not-allowed; }
button.principal { background: var(--acento); border-color: var(--acento); color: #0b0e14; font-weight: 600; }
button.enlace { background: none; border: none; color: var(--acento); padding: 0; text-decoration: underline; }

nav { display: flex; gap: var(--espacio-2); margin-bottom: var(--espacio-4); }
nav button[aria-current="page"] { border-color: var(--acento); color: var(--acento); }

table { width: 100%; border-collapse: collapse; font-size: var(--texto-sm); }
th, td { text-align: left; padding: var(--espacio-2) var(--espacio-3); border-bottom: 1px solid var(--borde); vertical-align: top; }
th { color: var(--texto-suave); font-weight: 600; }
td.numero, th.numero { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr:hover { background: var(--superficie); }

.tarjeta {
  background: var(--superficie); border: 1px solid var(--borde);
  border-radius: var(--radio); padding: var(--espacio-4); margin-bottom: var(--espacio-4);
}
.tarjeta .fila { display: flex; gap: var(--espacio-3); align-items: flex-end; flex-wrap: wrap; }

.estado { font-size: var(--texto-xs); padding: 2px var(--espacio-2); border-radius: var(--radio); border: 1px solid var(--borde); }
.estado.ACTIVE { color: var(--bien); border-color: var(--bien); }
.estado.SUSPENDED { color: var(--atencion); border-color: var(--atencion); }
.estado.CLOSED { color: var(--mal); border-color: var(--mal); }

.error {
  border: 1px solid var(--mal); border-left: 3px solid var(--mal);
  background: var(--superficie); border-radius: var(--radio);
  padding: var(--espacio-3) var(--espacio-4); margin-bottom: var(--espacio-4);
  color: var(--texto);
}
.cargando, .vacio { color: var(--texto-tenue); }
.pie { color: var(--texto-tenue); font-size: var(--texto-xs); margin-top: var(--espacio-8); }

.entrar { max-width: 380px; margin: 10vh auto; }
.entrar .tarjeta > * + * { margin-top: var(--espacio-3); }
`;
