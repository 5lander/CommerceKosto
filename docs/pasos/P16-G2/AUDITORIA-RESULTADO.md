# P16-G2 — Resultado de la auditoría

**Alcance del diff:** `scripts/` (restauración por tenant), `tools/audit/migrations.mjs` (M12), dos
migraciones **sin cambio de esquema de datos** (`ALTER FUNCTION`, clave foránea diferible),
`docs/runbooks/respaldos-y-restauracion.md`, `docs/incidencias/INC-030` e `INC-007`,
`docs/pasos/P16-G2/`, `ESTADO.md` y `CHANGELOG`. **Ni una línea de `apps/api/src` ni de `apps/web`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | Sigue sin haber un solo `WHERE company_id` escrito a mano: el recorte y la validación los hace RLS. Lo que se añade es orden, no lógica |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`, `audit:duplication` (`Found 0 clones`). `audit:forbidden` **47 reglas sobre 578 archivos** — y **paró un carácter de control** en la regex nueva de M12 antes del commit (INC-007, caso 14) |
| C · Seguridad | ✅ | **INC-030**: tres guardas fijan su `search_path`, así que dejan de resolver el nombre de la tabla que vigilan con el del llamante. La restauración **no bajó ninguna barrera para funcionar**: cuando faltó el privilegio `TEMP`, se cambió el script, no el privilegio |
| D · Base de datos | ✅ | `audit:migrations` **22/22** con el check **M12** nuevo · `migrate:verify` **4/4**, incluida la escalera completa y «sin deriva con `schema.prisma`» (Prisma no sabe declarar `DEFERRABLE`, así que el esquema no cambia) |
| E · Reglas de negocio | ✅ | Los dos guardianes del libro **siguen puestos y siguen comprobando**: el del mes cerrado deja pasar porque el mes está abierto de verdad, y al final se verifica que vuelven a estar cerrados los mismos que en la copia |
| F · Rendimiento | ✅ | No aplica: es tooling de operación. El simulacro completo sobre un tenant de 24 filas es instantáneo; el tiempo lo pone el `pg_restore` de la copia completa |
| G · Pruebas | ✅ | **905 unitarias** y **554 de integración**, sin cambios: la prueba de este paquete **es el simulacro**, y está en `CONSTRUCCION.md` y en el runbook. El check M12 tiene su prueba del guardián: quitando la migración del arreglo vuelve a saltar |
| H · Documentación | ✅ | Runbook con los dos guardianes, la tabla de ensayos distinguiendo «sin libro» de «con libro y mes cerrado», cómo repetirlo y la **señal de los 20 minutos**; INC-030; INC-007 caso 14 |
| I · Duplicación / YAGNI | ✅ | Se añadió una constante SQL y una comprobación. Ninguna abstracción nueva |

### Lo que este paquete demuestra, y no es poco

**El simulacro anterior daba «probado» y no lo estaba.** Restauraba un tenant sin libro, que es el
caso que ningún cliente real tiene. Este encontró **cuatro cosas** que ninguna lectura del código
había encontrado, tres de ellas en el primer minuto de ejecución, y una —INC-030— que es de
seguridad y no de operación.

### La decisión del usuario que hizo falta

Reponer un conteo **confirmado** no se podía sin tocar algo: sus tres `CHECK` son bicondicionales y
su trigger prohíbe volver a borrador. El usuario eligió **la clave foránea diferible** frente a
aflojar los `CHECK` con un modo restauración en la base, o aceptar el hueco. El contra está escrito
en `scripts/lib/tenant.mjs`, en la migración y en el runbook: durante esa transacción el guardián de
la línea pasa en vacío, y la coherencia la sostiene la clave foránea al COMMIT.

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 578 archivos
✔ no dependency violations found (395 modules, 1779 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 22 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  905 passed (905)                  (unitarias)
      Tests  554 passed | 5 skipped (559)      (integracion)
ℹ tests 49                                     (apps/web, node --test)
```

**`npm run audit` — exit 0** · `npm run migrate:verify` — **4/4**.
