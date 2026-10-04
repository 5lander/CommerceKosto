# INC-035 — `Error: Memory allocation error` en un login o en un `beforeAll` de las pruebas de integración

| Campo | Valor |
|---|---|
| **Fecha** | 2026-10-03 |
| **Paquete** | Dependencias (`bbc427e`) · P16-W |
| **Área** | pruebas · build |
| **Tiempo perdido** | ~40 min, repartidos en dos corridas y la medición |
| **Recurrencias** | **1** (dos ocurrencias). **Prevención: ninguna por ahora**, por decisión del usuario; si hay una tercera, se propone |

## Síntoma

Pruebas de integración en rojo **en suites que no tocan lo que cambió**, todas por el mismo error, y el
log de la API lo saca en `/auth/login` o sin petición asociada:

```
Error: Memory allocation error
AssertionError: expected 500 to be 200 // Object.is equality
 ❯ entrar test/integracion/productos.spec.ts:84:30
```

y, cuando cae en el `beforeAll`, la suite entera:

```
FAIL  integration  test/integracion/backoffice-correo.spec.ts > el back office y el correo transaccional
Error: Memory allocation error
```

Es **Argon2id** sin poder reservar su memoria al calcular o verificar un hash: `argon2-hasher.ts` pide
**64 MiB por hash** (`memoryCost` 65536 KiB, `timeCost` 3, `parallelism` 1).

## Contexto

| # | Cuándo | Qué corría | Qué falló |
|---|---|---|---|
| 1 | 2026-10-03, primer intento del commit `bbc427e` | El pre-commit | 1 prueba: el login de `productos.spec.ts:174` |
| 2 | 2026-10-03, `npm run audit` de P16-W | La auditoría completa, que corre la integración **dos veces** (`audit:sec-headers` y `audit:tests`) | 24 pruebas en `autenticacion-y-autorizacion.spec.ts` y la suite entera de `backoffice-correo.spec.ts` (24 líneas del error en el log) |

## Causa raíz

**La memoria comprometida del equipo estaba agotada**, no las pruebas. Medido con
`Win32_OperatingSystem` en la ocurrencia 2 y al día siguiente:

| Momento | Memoria comprometida libre (`FreeVirtualMemory`) | RAM libre | Resultado |
|---|---|---|---|
| Ocurrencia 2 (2026-10-03) | **2.618 MB** de 64.893 MB | 599 MB | 24 fallos |
| 2026-10-04, antes de liberar | 4.488 MB | 966 MB | — (no se corrió) |
| 2026-10-04, tras parar un `next dev` de otro proyecto (8.964 MB privados) | **13.196 MB** | 2.383 MB | **`npm run audit` exit 0, cero errores de memoria** |

Lo que la ocupaba, por memoria privada: las dos VM de WSL/Docker (`vmmem`, ~12 GB), un `next dev` de
otro proyecto (~9 GB, creciendo desde que arrancó), cuatro ventanas de VS Code (~7 GB) y tres
servidores de SonarLint (~3 GB). Con el `commit charge` casi al límite, una reserva de 64 MiB puede
fallar aunque haya RAM física.

## Solución

```powershell
# Medir antes de diagnosticar nada:
$o = Get-CimInstance Win32_OperatingSystem
"{0:N0} MB libres de {1:N0}" -f ($o.FreeVirtualMemory/1KB), ($o.TotalVirtualMemorySize/1KB)

# Quién la tiene:
Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 10 Name, Id, @{n='MB';e={[math]::Round($_.PrivateMemorySize64/1MB)}}
```

Liberar memoria comprometida —cerrar lo que no se use; lo de otros proyectos, solo con permiso de su
dueño— y repetir la corrida.

## Qué NO era

- **Concurrencia de las pruebas (64 MiB por hash × pruebas en paralelo)** → descartada. La integración
  corre en **un solo proceso** (`apps/api/vitest.config.ts:47-50`, `singleFork`), y las dos suites de
  la ocurrencia 2 calculan **un hash cada una**, en su `beforeAll`
  (`autenticacion-y-autorizacion.spec.ts:76-77`, `backoffice-correo.spec.ts:121`). El login de la
  ocurrencia 1 era secuencial. No había hashes simultáneos que limitar.
- **Los parámetros de Argon2** → no se tocan, por decisión del usuario. Bajar `memoryCost` solo en
  pruebas haría que la suite dejara de medir el hash que corre en producción.
- **Un fallo del paquete en curso** → no: ninguna de las suites que fallaron toca lo que cambiaba, y
  con la memoria liberada la misma auditoría, sin un cambio de código, pasa entera.

## Prevención

- [ ] ¿Verificación de `npm run audit`? **Posible** (avisar si `FreeVirtualMemory` es bajo antes de
      entrar en la base), pero **no se hace ahora**: el usuario decidió esperar a una tercera
      ocurrencia para proponerla.
- [ ] ¿Prueba automatizada? No: es estado del equipo, no del código.
- [ ] ¿Regla en `CLAUDE.md`? No.
- [ ] ¿ADR? No.

**La regla operativa mientras tanto:** ante un `Memory allocation error` en las pruebas, **mide la
memoria comprometida antes de mirar el código**.

## Referencias

- `docs/pasos/P16-K/CONSTRUCCION.md`, observación O1 (la hipótesis inicial y su descarte).
- `docs/pasos/P16-W/AUDITORIA-RESULTADO.md` (la auditoría en rojo y la repetición en verde).
