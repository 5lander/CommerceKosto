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
  /**
   * EL NOMBRE SALE DEL MANUAL DE MARCA, no de aquí.
   *
   * `DECISIONES.md` D1 puso «Costeo» como valor provisional con este motivo:
   * «No hay nombre comercial definido. **No inventar branding.**» El manual —que
   * `CLAUDE.md` §10 declara fuente única de la identidad— se titula *Manual de
   * marca PLATISE* y cierra con «PLATISE · MANUAL DE MARCA V3.0 · AGOSTO 2026».
   * El nombre estaba definido; lo que faltaba era haber abierto el archivo.
   */
  producto: 'Platise',

  /**
   * La firma verbal, manual p. 11. Va tal cual, y **sin cifra**: «el tagline no
   * lleva precio: un precio caduca y convierte la firma en promoción. Las líneas
   * con cifra son campaña, no firma».
   */
  firma: 'El margen, plato por plato.',

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

  /** Pantalla 1b: olvidé mi contraseña y restablecer desde el enlace del correo. */
  recuperacion: {
    olvido: '¿Olvidaste tu contraseña?',
    olvideTitulo: 'Olvidé mi contraseña',
    olvideAyuda: 'Escribe el correo con el que entras y te mandaremos un enlace para elegir otra.',
    pedir: 'Enviarme el enlace',
    pidiendo: 'Enviando…',
    // La MISMA frase exista o no la cuenta: decir otra cosa revelaría quién tiene cuenta.
    pedido:
      'Si ese correo tiene una cuenta activa, te llegará un enlace en unos minutos. Sirve una sola vez y caduca: úsalo en cuanto llegue. Revisa también el correo no deseado.',
    volverAEntrar: 'Volver a entrar',
    restablecerTitulo: 'Elige tu contraseña nueva',
    restablecerAyuda: 'Al guardarla se cerrarán las sesiones abiertas en otros dispositivos.',
    nueva: 'Contraseña nueva',
    repetir: 'Repítela',
    politica: 'Al menos 12 caracteres. Una frase que recuerdes sirve mejor que una palabra con símbolos.',
    corta: 'Tiene menos de 12 caracteres. Alárgala antes de guardar: si no, el enlace se gastaría.',
    noCoinciden: 'Las dos contraseñas no coinciden.',
    guardar: 'Guardar contraseña',
    guardando: 'Guardando…',
    hecho: 'Listo. Tu contraseña cambió y las demás sesiones se cerraron. Ya puedes entrar con la nueva.',
    sinToken: 'Este enlace está incompleto. Ábrelo tal cual llegó en el correo, o pide otro.',
    pedirOtro: 'Pedir otro enlace',
  },

  /** El armazón: la barra lateral y la cabecera (P16). */
  navegacion: {
    etiqueta: 'Navegación principal',
    menu: 'Menú',
    general: 'General',
    catalogo: 'Catálogo',
    analisis: 'Análisis',
    operacion: 'Operación diaria',
  },

  /** Pantallas 5 y 6: el alta y la ficha de un insumo. */
  insumo: {
    nuevo: 'Nuevo insumo',
    nuevoTitulo: 'Nuevo insumo',
    nuevoAyuda: 'Lo que se compra o se prepara. Sus presentaciones de compra y su precio se añaden después.',
    nombre: 'Nombre',
    tipo: 'Tipo',
    unidad: 'Unidad de uso',
    unidadAyuda: 'La unidad en la que se escribe en las recetas. El tipo y la unidad no se pueden cambiar después: las cantidades ya registradas cambiarían de magnitud.',
    rendimiento: 'Rendimiento (%)',
    rendimientoAyuda: 'Lo que queda después de limpiar: 85 si de cada kilo quedan 850 gramos útiles. 100 si no se pierde nada.',
    grupo: 'Grupo',
    sinGrupo: 'Sin grupo',
    confianza: 'Origen del precio',
    confianzas: { FACTURA: 'Con factura', ESTIMADO: 'Estimado, sin factura' },
    llevaStock: '¿Se produce en lote y se guarda?',
    llevaStockSi: 'Sí: se produce en lote y aparece en inventario',
    llevaStockNo: 'No: al vender se descuentan sus ingredientes',
    crear: 'Crear insumo',
    creando: 'Creando…',
    fichaTitulo: 'Insumo',
    editar: 'Editar',
    editarTitulo: 'Editar insumo',
    fijos: 'No se pueden cambiar:',
    guardar: 'Guardar cambios',
    guardando: 'Guardando…',
    volverACargar: 'Ver la versión actual',
    ivaDelGrupo: 'IVA de compra del grupo',
    costo: 'Lo que cuesta',
    costoNeto: 'Costo neto por unidad de uso',
    costoBruto: 'Costo bruto por unidad de uso',
    sobrecostoDeMerma: 'Sobrecosto por la merma',
    vigenteDesde: 'Vigente desde',
    sinPrecioConfirmado: 'Todavía no tiene ningún precio confirmado: cuesta lo que se sepa cuando alguien lo confirme, no cero.',
    articulos: 'Presentaciones de compra',
    articulo: 'Presentación',
    presentacion: 'Contenido',
    ivaDeCompra: 'IVA',
    sinArticulos: 'Todavía no tiene presentaciones de compra.',
    historial: 'Historia del precio',
    sinHistorial: 'Todavía no tiene precios registrados.',
    precio: 'Precio',
    estadoDelPrecio: 'Estado',
    vigente: 'Vigente',
    estadosDelPrecio: { SUGGESTED: 'Sugerido', CONFIRMED: 'Confirmado', REJECTED: 'Rechazado' },
    archivar: 'Archivar',
    reactivar: 'Reactivar',
    archivarPregunta:
      'Al archivarlo deja de aparecer en el listado de insumos. Sus recetas, precios y movimientos no se tocan, y se puede reactivar.',
    reactivarPregunta: 'Al reactivarlo vuelve a aparecer en el listado de insumos.',
    archivarSi: 'Sí, archivar',
    reactivarSi: 'Sí, reactivar',
  },

  /** Pantalla 4: el catálogo de insumos. */
  insumos: {
    titulo: 'Insumos',
    ayuda: 'Lo que se compra o se prepara, y cuánto cuesta por unidad de uso.',
    ayudaSinCosto: 'Lo que se compra o se prepara, con su unidad y su rendimiento.',
    incluirArchivados: 'Incluir archivados',
    buscar: 'Buscar por nombre',
    grupo: 'Grupo',
    todosLosGrupos: 'Todos los grupos',
    insumo: 'Insumo',
    rendimiento: 'Rendimiento',
    costoDeUso: 'Costo por unidad de uso',
    // Sin precio confirmado NO es cero: se dice, porque un cero abarataría el plato sin avisar.
    sinPrecio: 'Sin precio',
    archivado: 'Archivado',
    tipos: { COMPRADO: 'Comprado', PRODUCIDO: 'Preparación' },
    vacio: 'Todavía no hay insumos en el catálogo.',
    vacioAyuda: 'Cuando se den de alta o se importen, aquí verás cuánto cuesta cada uno por unidad de uso.',
    sinCoincidencias: 'Ningún insumo coincide con la búsqueda.',
    sinCoincidenciasAyuda: 'Prueba con otra palabra o con todos los grupos.',
  },

  /** Pantalla 2 (U2): el mes de la sucursal de un vistazo. */
  inicio: {
    titulo: 'Inicio',
    ayuda: 'Cómo va el mes en esta sucursal.',
    venta: 'La venta y lo que deja',
    operacion: 'La operación',
    ventaNeta: 'Venta neta del mes',
    foodCostReal: 'Food cost real',
    teorico: 'Teórico:',
    brecha: 'Brecha teórico–real',
    utilidad: 'Utilidad operativa',
    margenDeSeguridad: 'Margen de seguridad:',
    primeCost: 'Prime cost',
    varianza: 'Varianza de inventario',
    cobertura: 'Cobertura del conteo',
    sinConteo: 'Sin conteo',
    porReponer: 'Ítems por reponer',
    sinCosto: 'Ítems sin costo',
    reposicion: 'Qué reponer',
    estado: 'Estado',
    semaforos: { REPONER: 'Reponer', OK: 'Bien' },
    sinItems: 'Todavía no hay ítems con movimientos en esta sucursal este mes.',
    sinItemsAyuda: 'Cuando se registren compras o conteos, aquí verás qué hay que reponer.',
  },

  sucursal: {
    titulo: '¿En qué sucursal estás?',
    ayuda: 'Los números que veas son de la sucursal que elijas.',
    ninguna: 'Tu usuario todavía no tiene ninguna sucursal asignada.',
    ningunaAyuda: 'Pídele a quien administra el sistema que te asigne una.',
    cambiar: 'Cambiar de sucursal',
    etiqueta: 'Sucursal',
  },

  periodo: {
    mes: 'Mes',
    anio: 'Año',
    /** En orden: el índice 0 es enero. */
    meses: [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ],
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
    // Estaba escrito dentro de la pantalla hasta P14, contra D11. Un texto
    // visible que no vive aquí es un texto que nadie revisa.
    sinPrecio: 'Sin precio:',
    // P16-D: un plato sin receta en esta sucursal no cuesta cero, le falta la
    // receta. Dos frases: qué pasa y qué hacer.
    sinReceta: 'Sin receta en esta sucursal: el costo no se puede calcular. Escribe su receta para verlo.',
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
    /** La raya para un dato que no aplica. No es «N/A» ni «null». */
    sinDato: '—',
    reintentar: 'Volver a intentar',
    volver: 'Volver',
    cancelar: 'Cancelar',
    sinPermiso: 'Tu usuario no tiene acceso a esta pantalla.',
    sinPermisoAyuda: 'Si crees que debería tenerlo, pídeselo a quien administra el sistema.',
    sesionCaducada: 'Tu sesión se cerró. Vuelve a entrar.',
    // D-16.2: un mes que nadie ha trabajado no es un error, es un estado.
    mesSinAbrir: 'Este mes todavía no tiene datos en esta sucursal.',
    mesSinAbrirAyuda: 'Cuando se carguen sus ventas o sus movimientos, aquí aparecerán sus números.',
  },
} as const;
