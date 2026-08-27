# FASE0-CHECKLIST.md — Todo lo que no es código y bloquea el lanzamiento

> Estos puntos **no dependen de Claude Code** y varios tienen tiempos de espera de terceros: se arrancan **en paralelo** a la construcción. Ordenados por lo que destrancan. Se revisa al inicio de cada corrida: si un ítem 🔴 sigue pendiente cuando el paquete que destranca se acerca, avisar al usuario.

## 🔴 A. Trámites y cuentas con tiempo de espera — arrancar de inmediato

| # | Ítem | Por qué urge | Destranca | Estado |
|---|---|---|---|---|
| A1 | **Nombre comercial y verificación de disponibilidad** (dominio, marca en SENADI) | Hoy el proyecto usa `costeo-saas` como nombre de trabajo (D1). Todo lo visible al usuario, el dominio y el correo dependen de esto | P12, P14, lanzamiento | ⬜ |
| A2 | **Dominio + correo transaccional** con dominio verificado (SPF, DKIM, DMARC) | La verificación de dominio y la reputación de envío tardan días | Invitaciones de usuario, recuperación de contraseña | ⬜ |
| A3 | **Decisión societaria y RUC** bajo el que se factura el SaaS | Facturación a los primeros clientes | Cobro | ⬜ |
| A4 | **Asesoría legal: LOPDP** — el sistema almacena datos de empleados y proveedores de los clientes | Ecuador. Se necesita política de privacidad, tratamiento y respuesta a brechas antes del primer cliente real | Lanzamiento | ⬜ |
| A5 | **Términos de servicio y contrato de SaaS**, incluyendo confidencialidad de recetas y propiedad de los datos del cliente | Es el producto: el cliente entrega su secreto competitivo | Primer cliente | ⬜ |
| A6 | **Credenciales de producción** (hosting, base de datos gestionada, gestor de secretos) | D10 sigue provisional | P15 | ⬜ |
| A7 | **Consulta comercial a Tipti** sobre acceso a datos bajo contrato, términos de uso y derecho de redistribución | Solo informativa. **No bloquea nada de este proyecto** (D8), pero la respuesta define si la Fase 2 existe | Fase 2 | ⬜ |

## 🟠 B. Contenido que solo el negocio puede aportar

| # | Ítem | Nota | Estado |
|---|---|---|---|
| B1 | **Qué representa el tipo `LNK` en T1 del Excel** | 4 filas sin documentar. Es D4 y bloquea la migración de datos reales | ⬜ |
| B2 | **Casos conocidos calculados a mano** desde el Excel: al menos 8, incluyendo base AP, base EP, una subpreparación anidada y un combo | Es el insumo de P5. Sin esto el motor de costeo no se puede validar | ⬜ |
| B3 | **Catálogo semilla de unidades y factores de conversión** del dominio de alimentos | Alimenta P2 | ⬜ |
| B4 | **Estrategia de precios del SaaS** y definición de los tres planes | D5 sigue provisional | ⬜ |
| B5 | **Identidad visual y manual de marca** | Llega en P14. Antes, tokens neutros | ⬜ |
| B6 | **Plan del piloto con criterio de éxito**: qué comercio, cuántas ubicaciones, qué se considera que funcionó | Define hasta dónde llega el MVP vendible | ⬜ |
| B7 | **Análisis de competencia** en costeo de alimentos para el mercado local | Informa precio y posicionamiento | ⬜ |

## 🟡 C. Proyecto y operación

| # | Ítem | Nota | Estado |
|---|---|---|---|
| C1 | **Factor camión**: repo con branch protection, credenciales en gestor de secretos, acceso de emergencia documentado | Que nada dependa de una sola persona y una sola máquina | ⬜ |
| C2 | **Equipo y responsables** | Quién hace qué y cuándo entra | ⬜ |
| C3 | **Soporte al lanzamiento**: quién responde y en qué horario | El back office con acceso privilegiado exige saber quién puede entrar a un tenant | ⬜ |
| C4 | **Presupuesto operativo**: hosting, base de datos, correo | Retomar antes de fijar precios (B4) | ⬜ |
| C5 | **Plan de migración desde el Excel** de los clientes que ya lo usan | Depende de B1 y de P10 | ⬜ |
| C6 | **Presupuestar mantenimiento recurrente del frontend** | Next.js no tiene LTS: exige upgrades de major aproximadamente anuales. No es opcional ni postergable indefinidamente | ⬜ |
| C7 | **Planificar el salto de Node 24 a Node 26** cuando promueva a LTS (~oct-2026) | Node 24 vence en abril de 2028; Node 26 llega hasta ~abril de 2029 | ⬜ |

## 🟢 D. Técnico — se le pide a Claude Code cuando toque

| # | Ítem | Paquete sugerido |
|---|---|---|
| D1 | Logging estructurado (JSON) con correlation ID de punta a punta | P0 |
| D2 | Contratos OpenAPI generados desde el código | P8 |
| D3 | Healthchecks y readiness probes | P0 |
| D4 | Generador de datos sintéticos realistas del dominio (companies, ubicaciones, ítems, recetas, 2 años de movimientos) | P15 |
