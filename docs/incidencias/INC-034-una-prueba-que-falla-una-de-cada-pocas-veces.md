# INC-034 — `read ECONNRESET` en una prueba que pasó hace cinco minutos

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-25 |
| **Paquete** | P16-U6 |
| **Área** | pruebas · build |
| **Tiempo perdido** | ~25 min |
| **Recurrencias** | 0 |

> **El mismo árbol, dos veredictos.** La corrida del PR pasó entera; la del push a `main` —con el
> commit de merge, contenido idéntico— falló. Y al relanzar **ese mismo job sin tocar nada**, pasó.

## Síntoma

```
FAIL  integration  test/integracion/limite-de-tasa.spec.ts
  > en PARALELO: el limite se sostiene contra peticiones simultaneas (la 🔴 que faltaba, INC-007)
  > treinta /olvido simultaneos desde la MISMA IP con treinta correos: exactamente diez 202 y treinta golpes

Error: read ECONNRESET
```

**No es una aserción que falla: es la conexión que se cae.** El mensaje no dice nada del límite de
tasa, aunque aparece dentro de su prueba — y esa es la parte que despista, porque invita a buscar el
fallo en el limitador, que está bien.

## Contexto

La primera corrida de CI sobre `main` después del merge de la entrega P10 → P16-V.

## Causa raíz

`app.init()` **monta la aplicación pero no abre el puerto.** Quien lo abre es supertest, y lo hace
**perezosamente**: al construir cada `Test` mira `server.address()` y, si está vacía, llama a
`listen(0)`.

La prueba crea **treinta peticiones en el mismo tick**:

```ts
await Promise.all(peticiones.map((pedir) => pedir()));
```

Los treinta `Test` se construyen antes de que ninguno termine de escuchar —`listen` es asíncrono—,
así que **los treinta ven la dirección vacía y los treinta intentan abrir el puerto**. Lo que sale
de ahí es un socket reseteado en una petición al azar.

**Por qué es intermitente:** depende de si el primer `listen` alcanza a completarse antes de que se
construyan los demás. Con la máquina descargada suele ganar; bajo carga —un runner compartido
ejecutando 563 pruebas— no siempre.

## Solución

Poner el servidor a escuchar **una vez**, antes de cualquier lote en paralelo:

```ts
await app.init();
await app.listen(0);
```

**Y no solo en la suite que falló.** Otras **cinco** tenían la misma exposición, encontradas
buscando las tres condiciones juntas —`Promise.all`, `request(` y ningún `listen(`—:
`analitica`, `consolidado`, `productos`, `recetas` y `rendimiento-del-consolidado`. Arreglar solo la
que falló habría dejado cinco esperando su turno.

## Qué NO era

- **El limitador de tasa** → descartado: el error es de transporte y no llega a evaluar ningún
  límite. Las otras trece pruebas del archivo pasan
- **Carga del runner, sin más** → descartado como *causa*: la carga es el detonante, no el motivo.
  Sin la carrera, treinta peticiones concurrentes no resetean nada
- **Una diferencia entre el PR y `main`** → descartado: el relanzamiento del **mismo** job pasó

## Prevención

**Convertida en check, en el mismo paquete.** Regla nueva de `audit:forbidden`:

| Regla | Qué detecta |
|---|---|
| `lote-en-paralelo-sin-servidor-escuchando` | Una suite de `test/integracion/` con `Promise.all` **y** `request(` **y** ningún `listen(` |

`audit:forbidden` pasa de **49 a 50 reglas**. Verificada **viéndola fallar**: se quitó el `listen`
de `consolidado.spec.ts` y la señaló por su nombre.

### Lo que esto importa más allá del arreglo

Una prueba que falla una de cada pocas veces **no es un incordio menor: es el peor daño posible a
un pipeline**, porque enseña a relanzar en vez de leer. Y este repositorio acaba de pagar
[INC-033](INC-033-la-base-arranca-sin-roles-y-ci-nunca-estuvo-en-verde.md), cuya lección entera era
que **CI solo protege si alguien mira su resultado**. Un verde que se consigue relanzando es la
misma enfermedad con otro disfraz.

> **Regla práctica:** ante un fallo de CI que no se reproduce, la pregunta no es «¿fue mala suerte?»
> sino «¿qué carrera existe que la carga destapa?». Aquí la respuesta estaba en cinco archivos más.
