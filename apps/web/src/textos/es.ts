/**
 * Los textos visibles, en un archivo de recursos — D11.
 *
 * Hay un solo idioma (español de Ecuador) y aun así viven aquí, porque es lo que
 * D11 fija desde el primer componente. El beneficio real no es la traducción: es
 * que **se pueden leer todos de una vez** y comprobar que están escritos para un
 * dueño de restaurante y no para un programador.
 *
 * LA REGLA AL ESCRIBIRLOS: nada de «error», «inválido», «token», «endpoint» ni
 * «registro». Se dice qué pasó y qué hacer. Si un texto no cabe en la frase que
 * alguien diría en voz alta a un cliente, está mal escrito.
 */

export const TEXTOS = {
  producto: 'Costeo',

  acceso: {
    titulo: 'Entrar',
    correo: 'Correo',
    contrasena: 'Contraseña',
    entrar: 'Entrar',
    entrando: 'Entrando…',
    // NO dice si el correo existe: eso permitiría averiguar quién tiene cuenta.
    // El backend ya responde lo mismo en los dos casos; esto no lo contradice.
    rechazado: 'El correo o la contraseña no coinciden.',
    bloqueado:
      'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.',
    salir: 'Salir',
  },

  sucursal: {
    titulo: '¿En qué sucursal estás?',
    ayuda: 'Los números que veas son de la sucursal que elijas.',
    ninguna: 'Tu usuario todavía no tiene ninguna sucursal asignada.',
    ningunaAyuda: 'Pídele a quien administra el sistema que te asigne una.',
    cambiar: 'Cambiar de sucursal',
  },

  periodo: {
    mes: 'Mes',
    anio: 'Año',
  },

  costeo: {
    titulo: 'Costeo por producto',
    ayuda: 'Cuánto cuesta cada plato y cuánto deja.',
    producto: 'Producto',
    costoBruto: 'Costo bruto',
    costoNeto: 'Costo neto',
    costoTotal: 'Costo total',
    pvp: 'PVP',
    ventaNeta: 'Venta neta',
    margen: 'Margen',
    foodCost: 'Food cost',
    multiplicador: 'Multiplicador',
    vacio: 'Todavía no hay productos con precio en esta sucursal.',
    vacioAyuda:
      'Cuando cargues la carta y sus recetas, aquí verás lo que cuesta cada plato.',
    // El PVP incluye IVA y el food cost se calcula sobre la venta neta (R14).
    // Decirlo evita la pregunta más frecuente frente a una hoja de cálculo.
    notaIva: 'El PVP incluye IVA. El food cost se calcula sobre la venta neta.',
  },

  menu: {
    titulo: 'Ingeniería de menú',
    ayuda: 'Qué platos sostienen el negocio y cuáles hay que trabajar.',
    cuadrantes: {
      ESTRELLA: 'Estrellas',
      CABALLO: 'Caballos',
      ROMPECABEZAS: 'Rompecabezas',
      PERRO: 'Perros',
      SIN_DATOS: 'Sin datos',
      INACTIVO: 'Inactivos',
    },
    explicaCuadrante: {
      ESTRELLA: 'Se venden mucho y dejan mucho. No los toques.',
      CABALLO: 'Se venden mucho y dejan poco. Sube el precio o baja el costo.',
      ROMPECABEZAS: 'Dejan mucho y se venden poco. Dales sitio en la carta.',
      PERRO: 'Ni se venden ni dejan. Candidatos a salir.',
      SIN_DATOS: 'Activos, pero sin ventas cargadas este mes.',
      INACTIVO: 'No están a la venta ahora mismo.',
    },
    referencia: 'Margen de referencia',
    unidades: 'Unidades',
    indice: 'Índice de popularidad',
    vacio: 'Todavía no hay ventas cargadas para este mes.',
    vacioAyuda:
      'Carga las unidades vendidas del mes y aquí verás la matriz completa.',
  },

  ventas: {
    titulo: 'Carga de ventas',
    ayuda: 'Cuántas unidades se vendió de cada producto este mes.',
    unidades: 'Unidades',
    mesAnterior: 'Mes anterior',
    guardar: 'Guardar',
    guardando: 'Guardando…',
    guardado: 'Guardado',
    sinCambios: 'Sin cambios que guardar',
    atajos: 'Enter o ↓ para bajar · ↑ para subir · Tab para avanzar',
    vacio: 'Todavía no hay productos activos en esta sucursal.',
    vacioAyuda: 'Cuando actives productos en la carta, aparecerán aquí para cargar sus ventas.',
  },

  inventario: {
    titulo: 'Inventario y conteo',
    ayuda: 'Lo que dice el sistema y lo que hay en la estantería.',
    item: 'Ítem',
    teorico: 'Debería haber',
    contado: 'Hay',
    diferencia: 'Diferencia',
    valorizada: 'Valor de la diferencia',
    unidad: 'Unidad',
    contar: 'Anotar conteo',
    confirmar: 'Confirmar el conteo',
    confirmando: 'Confirmando…',
    sinContar: 'Sin contar',
    cobertura: 'Del valor del inventario, contado',
    // D7 / ADR-010 §5. Es la diferencia que más se pregunta al ver el número.
    notaSinContar:
      'Un ítem que nadie contó vale lo que el sistema dice que hay, no cero. Por eso se ve qué parte del inventario se contó de verdad.',
    vacio: 'Todavía no hay movimientos de inventario en esta sucursal.',
    vacioAyuda: 'En cuanto registres la primera compra, aquí verás los saldos.',
  },

  comun: {
    cargando: 'Cargando…',
    reintentar: 'Volver a intentar',
    sinPermiso: 'Tu usuario no tiene acceso a esta pantalla.',
    sinPermisoAyuda: 'Si crees que debería tenerlo, pídeselo a quien administra el sistema.',
    sesionCaducada: 'Tu sesión se cerró. Vuelve a entrar.',
  },
} as const;
