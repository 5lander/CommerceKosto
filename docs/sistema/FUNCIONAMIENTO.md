# Cómo funciona el sistema — documento maestro

> Se actualiza en cada paquete que cambie la estructura. Es el mapa que lee alguien que llega nuevo.

## Visión

```mermaid
graph TB
    subgraph Entrada
        UI[App cliente]
        BO[Back office]
        IMP[Importación Excel/CSV]
    end
    subgraph Dominio
        CAT[catalog · fuente única de verdad]
        PRI[pricing · precios con vigencia]
        REC[recipes · recetas versionadas]
        PRO[products · productos y combos]
        COST[costing · MOTOR DE COSTEO]
        INV[inventory · libro append-only]
        PER[periods]
        ANA[analytics · las 6 vistas]
    end
    UI --> CAT & PRI & REC & PRO & INV
    IMP --> CAT & REC
    BO --> CAT
    CAT --> PRI --> COST
    CAT --> REC --> COST
    PRO --> COST
    COST --> ANA
    INV --> ANA
    PER --> ANA
    INV --> COST
```

## Regla de dependencia

```mermaid
graph LR
    I[infrastructure] --> A[application] --> D[domain]
```

El dominio no sabe que existe la infraestructura. El motor de costeo se ejecuta con la base de datos apagada.

## Jerarquía de datos

```mermaid
graph TD
    C[company = tenant] --> L1[ubicación BODEGA]
    C --> L2[ubicación LOCAL]
    C --> L3[ubicación LOCAL]
    C --> CAT[catálogo de ítems · de la company]
    C --> PROD[productos maestros · de la company]
    L1 --> INV1[inventario propio]
    L2 --> INV2[inventario propio]
    L2 --> REC2[recetas propias]
    L2 --> PVP2[PVP propios]
    L3 --> INV3[inventario propio]
    L3 --> REC3[recetas propias]
```

**El catálogo y los productos maestros viven en la company. El inventario, las recetas y los precios de venta viven en la ubicación.**

## Flujo del costo

```mermaid
graph LR
    PC[precio de compra] -->|quita IVA si recuperable| PN[precio neto]
    PN -->|divide por factor de conversión| CB[costo bruto por unidad de uso]
    CB -->|divide por rendimiento| CN[costo neto por unidad de uso]
    CN -->|cantidad × base EP| CL[costo de línea]
    CB -->|cantidad × base AP| CL
    CL -->|suma| LOTE[costo del lote]
    LOTE -->|divide por porciones| POR[costo por porción]
    POR -->|× 1 + merma no atribuible| MER[costo con merma]
    MER -->|+ empaque neto| TOT[COSTO TOTAL POR UNIDAD]
```

Las fórmulas exactas están en `docs/SPEC.md` §12 a §18.


---

## El proceso de la API por dentro (desde P0)

Lo que atraviesa una petición, en orden. Las cuatro protecciones globales se registran en `AppModule`/`bootstrap.ts`, de modo que **las pruebas levantan exactamente la misma aplicación que se despliega**: una defensa cableada solo en `main.ts` no existe en los tests, y entonces el test de que existe no prueba nada.

```mermaid
graph TD
    REQ[petición HTTP] --> NONCE[middleware: nonce por respuesta]
    NONCE --> HDR[middleware: helmet + Permissions-Policy + Cache-Control]
    HDR --> PINO["pino-http: genReqId → correlation_id<br/>entra en AsyncLocalStorage<br/>sale en x-correlation-id"]
    PINO --> ROUTE{¿la ruta existe?}
    ROUTE -->|no| FILT
    ROUTE -->|sí| GUARD[ThrottlerGuard]
    GUARD -->|excede| FILT
    GUARD --> INT[TimeoutInterceptor]
    INT --> CTRL[controlador]
    CTRL --> FILT[ErrorFilter: code + message]
    FILT --> RES[respuesta]
```

**Las cabeceras van como middleware de plataforma y no como interceptor de Nest, a propósito.** Un interceptor solo corre para peticiones que llegan a un manejador: un 404, un 429 del limitador o un cuerpo malformado saldrían **sin cabeceras**, y son justo las respuestas de las que un atacante aprende más. Hay una prueba de integración por cabecera que lo comprueba sobre un 404.

### Composición interna

```mermaid
graph TB
    subgraph domain["shared/domain — sin dependencias"]
        DEC[decimal/ · núcleo y escalas]
        MON["money/ · Money · Ratio · Count · Quantity"]
        UNI[unidad/ · UnidadDeUso]
    end
    subgraph app["shared/application — solo interfaces"]
        PA[AuditLogPort]
        PM[MailerPort]
        PS[FileStoragePort]
    end
    subgraph infra["shared/infrastructure"]
        CFG[config/ · esquema Zod]
        OBS[observability/ · correlación y logger]
        PER[persistence/ · PrismaConnection]
        HTTP[http/ · cabeceras, error, timeout]
        HLT[health/ · /health y /ready]
        FK[fakes/ · correo y almacenamiento]
    end
    PER -.implementa.-> PA
    FK -.implementan.-> PM & PS
    MON --> DEC
    MON --> UNI
```

`decimal.js` solo lo ve `shared/domain/decimal/` (ADR-003). `dependency-cruiser` y `audit:forbidden` lo hacen cumplir.

### Salud del proceso

| Ruta | Qué responde | Toca la base |
|---|---|---|
| `/health` | *liveness* — ¿el proceso está vivo? | **No** |
| `/ready` | *readiness* — ¿puede atender tráfico? | Sí |

La distinción tiene coste concreto: si `/health` mirara la base, un corte de PostgreSQL haría que el orquestador **matara y reiniciara todas las réplicas**, que es lo peor que puede pasar durante un corte de base de datos. Con `/ready`, la réplica sale del balanceador y vuelve sola.
