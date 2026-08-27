# INC-{NNN} — {síntoma en una línea, tal como se ve}

> Copia esta plantilla a `docs/incidencias/INC-{NNN}-{slug-corto}.md` y añade la fila al índice de `docs/incidencias/README.md`.
> **El título es el SÍNTOMA, no la causa.** Cuando vuelva a pasar, lo que ves es el síntoma; la causa es lo que estás buscando.

| Campo | Valor |
|---|---|
| **Fecha** | {AAAA-MM-DD} |
| **Paquete** | P{n} |
| **Área** | base de datos · arquitectura · tipos · pruebas · build · dominio · frontend · despliegue |
| **Tiempo perdido** | {aprox. minutos u horas} |
| **Recurrencias** | 1 |

## Síntoma

Qué se vio exactamente. **Pega el mensaje de error literal**, incluido el stack trace si lo hay. No lo parafrasees: la próxima vez se va a buscar por ese texto.

```
{mensaje de error literal}
```

## Contexto

Qué se estaba haciendo cuando apareció. Comando ejecutado, archivo que se tocaba, migración que se corría.

## Causa raíz

Por qué pasaba **de verdad**. No la primera hipótesis: la causa confirmada.

Si el diagnóstico llevó por caminos falsos, anótalos abajo en "Qué NO era" — vale casi tanto como la solución.

## Solución

Los pasos exactos que lo resolvieron. Comandos, diff o configuración concreta. Alguien debería poder aplicarlo sin entender el problema.

```
{comandos o diff}
```

## Qué NO era

Hipótesis que se descartaron y por qué. Esto evita repetir el mismo callejón sin salida.

- {hipótesis descartada} → descartada porque {razón}

## Prevención

- [ ] ¿Se puede convertir en una verificación de `npm run audit`?
- [ ] ¿Se puede convertir en una prueba automatizada?
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`?
- [ ] ¿Es una decisión que merece un ADR?

**Si la respuesta a alguna es sí, hazlo en el mismo paquete.** Una incidencia que se puede automatizar y se deja solo documentada volverá a pasar.

## Referencias

Enlaces a documentación, issues o discusiones que ayudaron. Con la fecha de consulta.
