# INC-001 — El hook de pre-commit no se ejecuta: `bad interpreter: /bin/sh^M`

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | build · despliegue |
| **Tiempo perdido** | 0 min — **anticipada en la fase PLAN y prevenida antes de que ocurriera** |
| **Recurrencias** | 0 |

## Síntoma

```
.githooks/pre-commit: /usr/bin/env: bad interpreter: No such file or directory
```

o bien, en Git Bash sobre Windows:

```
/usr/bin/bash: .githooks/pre-commit: /bin/sh^M: bad interpreter: No such file or directory
```

Y en el contenedor de PostgreSQL, la misma causa con otra cara:

```
/usr/local/bin/docker-entrypoint.sh: running /docker-entrypoint-initdb.d/10-bootstrap.sh
/docker-entrypoint-initdb.d/10-bootstrap.sh: line 2: $'\r': command not found
```

El `^M` del mensaje es un retorno de carro (CR, `\r`) que el intérprete lee como parte del nombre del programa.

## Contexto

Máquina de desarrollo Windows 10 con Git for Windows. El `gitconfig` de sistema trae **`core.autocrlf=true`** activo, que convierte los finales de línea a CRLF al hacer *checkout*. Los intérpretes POSIX —`sh` dentro del hook, `bash` dentro del contenedor Linux de PostgreSQL— no toleran el CR.

El efecto es peor de lo que parece: **el hook queda inservible desde el primer commit** y nadie lo nota, porque git no falla ruidosamente cuando un hook no se puede ejecutar. La auditoría deja de correr en pre-commit sin que aparezca ningún mensaje de error.

## Causa raíz

`core.autocrlf=true` gana sobre nada, pero **pierde contra `.gitattributes`**. Un repositorio sin `.gitattributes` hereda la configuración de la máquina de cada desarrollador, que es exactamente lo que no se quiere: el mismo repositorio produce archivos distintos según quién lo clone.

## Solución

`.gitattributes` en la raíz, **en el primer commit del proyecto**, declarando `eol=lf` para todo lo textual y `eol=crlf` solo para los scripts nativos de Windows:

```gitattributes
* text=auto eol=lf

*.sh            text eol=lf
*.sql           text eol=lf
.githooks/**    text eol=lf
docker/**/*.sh  text eol=lf

*.cmd text eol=crlf
*.bat text eol=crlf
*.ps1 text eol=crlf
```

Como los archivos de documentación ya estaban commiteados antes de existir `.gitattributes`, hay que renormalizar una vez:

```bash
git add --renormalize .
```

Complemento en `.editorconfig` (`end_of_line = lf`), para que el editor no vuelva a introducirlos.

**No se toca la configuración global de la máquina.** `.gitattributes` viaja con el repositorio; `core.autocrlf` no, y depender de que el próximo desarrollador la tenga igual es lo que causó el problema.

## Qué NO era

- **No es un problema del hook en sí ni de sus permisos.** `chmod +x` no lo arregla: el archivo es ejecutable, lo que falla es la línea shebang.
- **No es que falte `sh` en el PATH.** El mensaje dice `/bin/sh^M`, con el CR pegado: está buscando un programa cuyo nombre termina en retorno de carro.
- **No se arregla con `dos2unix`** de forma duradera: el siguiente `checkout` vuelve a convertir. Hay que atacar la causa, que es la ausencia de `.gitattributes`.
- **No basta con `.editorconfig`.** Controla lo que escribe el editor, no lo que git escribe al hacer checkout.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **Sí.** `audit:forbidden` incluye la regla `crlf-en-archivo-posix`: falla si algún archivo bajo `.githooks/`, `docker/**` o con extensión `.sh` contiene un `\r`. Además el script `doctor` comprueba que `git ls-files --eol` no reporte `crlf` en archivos declarados `eol=lf`.
- [x] ¿Se puede convertir en una prueba automatizada? **Sí, indirectamente:** el job de CI corre sobre Ubuntu; si un `.sh` se commitea con CRLF, el arranque del contenedor de PostgreSQL falla y el job se cae.
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? No: es específica de la plataforma de desarrollo, no del diseño.
- [x] ¿Es una decisión que merece un ADR? Está registrada en el ADR del hook (`core.hooksPath` frente a husky).

## Referencias

- `gitattributes(5)`, sección *"Effects — text"* — consultado 2026-08-27
- El orden de precedencia (`.gitattributes` > `core.autocrlf`) es lo que hace que la solución sea duradera
