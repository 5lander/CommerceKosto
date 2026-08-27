# ESTRATEGIA de pruebas

## Principio

El producto es la exactitud del número. Un fallo de UI se ve; un fallo de cálculo no. Por eso el peso de las pruebas está en el dominio, no en los controladores.

## Pirámide de este proyecto

| Nivel | Qué cubre | Sin base de datos |
|---|---|---|
| **Unitarias de dominio** (mayoría) | Motor de costeo, validación de ciclos, proyección del libro, cascada de subpreparaciones | ✅ Sí, obligatorio |
| **Integración** | Aislamiento entre companies y ubicaciones, confidencialidad por rol, conciliación, transacciones | ❌ Con base real |
| **Extremo a extremo** (mínimas) | Los tres flujos que si se rompen el cliente no puede trabajar: cargar una receta, registrar una compra, hacer un conteo | ❌ |

## Reglas duras

- **El motor de costeo se prueba con la base de datos apagada.** Si no se puede, las capas están mal
- **Los casos conocidos se calculan a mano ANTES de escribir el código**, desde el Excel original. Ver `casos-conocidos.md`
- Un caso conocido que cambia de resultado es un **fallo**, hasta que se demuestre que el Excel estaba mal y se documente por qué
- Cada endpoint que devuelva datos de inventario o costeo tiene su test de confidencialidad frente a `BODEGA`, verificado sobre la **respuesta cruda**
- Volumen sintético realista para las pruebas de rendimiento. Nunca 20 filas
- **Nunca datos reales de clientes** en desarrollo ni en staging

## Lo que no se prueba

Getters, mapeos triviales y componentes de UI sin lógica. Cobertura alta por sí sola no es un objetivo: cubrir un mapeo no protege de nada.
