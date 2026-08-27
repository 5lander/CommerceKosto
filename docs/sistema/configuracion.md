# Configuración

> Toda decisión de `DECISIONES.md` vive aquí como configuración versionada, **nunca como constante en el código**.

## Configuración por company (`company_settings`)

Los parámetros de costeo de `DECISIONES.md` D3. Se siembran al crear el tenant y el cliente puede editarlos.

**El motor de costeo los recibe como parámetro.** No los lee de ningún sitio global.

## Variables de entorno

Declaradas en `.env.example`, validadas por esquema al arrancar. La aplicación **no levanta** si falta una o tiene formato inválido.

| Selector | Valores | Efecto |
|---|---|---|
| `MAIL_ADAPTER` | `fake` \| `real` | Correo transaccional |
| `STORAGE_ADAPTER` | `fake` \| `real` | Almacenamiento de archivos |

**Con todos los selectores en `fake` el sistema funciona de punta a punta sin una sola credencial real.**

## Configuración de aplicación

| Archivo | Contiene |
|---|---|
| `config/branding.ts` | Nombre visible del producto (D1) |
| `config/periods.ts` | Política de cierre y reapertura (D6) |
| `config/plans.ts` | Límites por plan (D5) |
| `config/locale.ts` | Idioma, moneda, zona horaria, formatos (D11) |
