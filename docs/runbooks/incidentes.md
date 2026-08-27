# Runbook — incidentes

> Comandos exactos, sin prosa. Se completa en P15.
>
> **Esto es para incidentes operativos en producción.** Los problemas encontrados mientras se construye van en `docs/incidencias/`, que es otra cosa y tiene su propia plantilla.

## Incidentes propios de este proyecto

| Incidente | Gravedad | Primer paso |
|---|---|---|
| Sospecha de fuga entre tenants | 🔴 Máxima | Cortar acceso, revisar `access_log`, notificar a los clientes afectados |
| El libro de inventario no cuadra con la proyección | 🔴 | Reconstruir el saldo desde el libro; el libro manda siempre |
| La conciliación de food cost deja de dar 0 | 🔴 | Detener despliegues: hay un error en el motor de costeo |
| Acceso cross-tenant desde back office sin motivo registrado | 🟠 | Revisar quién y por qué; el registro es obligatorio |
| Importación que escribió parcialmente | 🟠 | Debe ser imposible por diseño (transacción única). Si ocurre, es un fallo de P10 |
