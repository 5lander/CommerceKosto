/**
 * El catálogo de unidades, para quien tiene que elegir una.
 *
 * **EXISTE POR INC-012.** La pantalla de alta de insumo ofrecía un campo libre
 * donde escribir `kg`, y lo que llega de un campo libre es `l`, `Kg`, `litro`,
 * `und`. Cada una de esas era un 500 —o, desde P16-A2, un 400— que se podía
 * haber evitado enseñando los diez códigos que hay. La validación del servidor
 * sigue estando: esto no la sustituye, le quita trabajo.
 *
 * NO LLEVA TENANT Y ES DE SOLO LECTURA. Un kilogramo pesa lo mismo en todas las
 * companies; la tabla es semilla de migración y el rol de la aplicación no
 * tiene `INSERT` sobre ella. Lo único que se exige es sesión y `catalog.read`,
 * como cualquier otra lectura del catálogo.
 */

import type { RepositorioDeCatalogo, UnidadLeida } from '../ports/repositorio-de-catalogo.port';

export interface DependenciasDeUnidades {
  readonly repositorio: RepositorioDeCatalogo;
}

export class ListarUnidades {
  public constructor(private readonly deps: DependenciasDeUnidades) {}

  public async ejecutar(): Promise<readonly UnidadLeida[]> {
    return this.deps.repositorio.listarUnidades();
  }
}
