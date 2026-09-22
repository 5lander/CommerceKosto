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
    carta: 'Carta',
    analisis: 'Análisis',
    operacion: 'Operación diaria',
  },

  /** Pantalla 9: la bandeja de precios sugeridos (R5). */
  precios: {
    titulo: 'Precios por confirmar',
    ayuda: 'Ningún precio cuenta para un costo hasta que alguien lo confirma. Cada sugerido, junto al que manda hoy.',
    insumo: 'Insumo',
    vigente: 'Vigente hoy',
    sugerido: 'Sugerido',
    decision: 'Decisión',
    desde: 'desde',
    iva: 'IVA',
    sinVigente: 'Sin precio vigente',
    confirmar: 'Confirmar',
    rechazar: 'Rechazar',
    verMas: 'Ver más',
    vacio: 'No hay precios esperando confirmación.',
    vacioAyuda: 'Cuando alguien sugiera un precio nuevo, aparecerá aquí para decidirlo.',
    sugerir: 'Sugerir precio',
  },

  /** Pantalla 11: la carta de la empresa y cómo está en cada sucursal. */
  productos: {
    titulo: 'Productos',
    ayuda: 'Lo que se vende, por porción. Cada sucursal decide si lo vende y a cuánto.',
    producto: 'Producto',
    enLaSucursal: 'En esta sucursal',
    pvp: 'PVP',
    seVende: 'Se vende',
    noSeVende: 'No se vende',
    sinConfigurar: 'Sin configurar',
    tipos: { SIMPLE: 'Con receta', COMBO: 'Combo' },
    sinCategoria: 'Sin categoría',
    archivado: 'Archivado',
    buscar: 'Buscar',
    categoria: 'Categoría',
    todasLasCategorias: 'Todas las categorías',
    incluirArchivados: 'Incluir archivados',
    vacio: 'Todavía no hay productos.',
    vacioAyuda: 'Un producto es una porción que se vende: con su receta, su categoría y su PVP en cada sucursal.',
    sinCoincidencias: 'Ningún producto coincide.',
    sinCoincidenciasAyuda: 'Prueba con otro nombre, quita el filtro de categoría o incluye los archivados.',
  },

  /** Pantalla 11: el alta y la ficha de un producto. */
  productoDeVenta: {
    nuevo: 'Nuevo producto',
    nuevoAyuda: 'Una porción que se vende. «Arroz con carne (segundo)» y «(plato fuerte)» son dos productos: distinta receta, categoría y PVP.',
    nombre: 'Nombre',
    tipo: 'Tipo',
    tipoAyuda: 'Con receta: se costea con sus insumos. Combo: se arma con otros productos con receta. El nombre y el tipo no se pueden cambiar después.',
    categoria: 'Categoría',
    crear: 'Crear producto',
    creando: 'Creando…',
    fichaTitulo: 'Producto',
    empaque: 'Empaque',
    sinEmpaque: 'Sin empaque',
    sucursales: 'En las sucursales',
    sinSucursales: 'Todavía no está configurado en ninguna sucursal: sin PVP no se vende en ninguna.',
    sucursal: 'Sucursal',
    estado: 'Estado',
    porciones: 'Porciones por lote',
    sinCapturar: 'Sin capturar',
    // Pantalla 12: configuración, empaque, costo, simulador y desglose.
    configurarEn: 'Configuración en',
    seVendeAqui: 'Se vende en esta sucursal',
    pvpConIva: 'PVP (con IVA)',
    porcionesAyuda:
      'Cuántas porciones salen de una tanda de la receta. Déjalo vacío si todavía no lo sabes: el costo por porción no se calcula hasta tenerlo.',
    guardar: 'Guardar',
    guardando: 'Guardando…',
    guardarEmpaque: 'Guardar empaque',
    empaqueAyuda: 'El empaque es un insumo más: su costo por unidad se suma a cada porción que se vende.',
    costoTitulo: 'Lo que cuesta y deja en esta sucursal',
    costoPorPorcion: 'Costo por porción',
    costoConMerma: 'Con provisión de merma',
    simuladorTitulo: '¿Y a otro precio?',
    pvpASimular: 'PVP a probar (con IVA)',
    simular: 'Simular',
    simulando: 'Calculando…',
    simuladorAyuda: 'No se guarda: recalcula solo la venta con ese precio.',
    conPvp: 'Con PVP',
    desglose: 'De qué está hecho el costo del lote',
    insumo: 'Insumo',
    cantidad: 'Cantidad',
    base: 'Base',
    costo: 'Costo',
    participacion: 'Peso en el lote',
    excluida: 'Excluida: no suma',
  },

  /** Pantalla 14: la receta de un producto o de una preparación. */
  receta: {
    titulo: 'Receta',
    enlace: 'Receta',
    en: 'En',
    ayuda: 'Guardar crea una versión nueva desde la fecha que elijas; la anterior queda en el historial.',
    sinVigente: 'Todavía no tiene receta vigente en esta sucursal.',
    vigenteDesde: 'La receta que manda hoy es la vigente desde el',
    hayFutura: 'Ya hay una versión guardada que empieza a valer más adelante. Si guardas, esta queda como la más nueva.',
    ayudaBase: 'Tal como se compra (AP): la cantidad incluye lo que se pierde al limpiar. Ya limpio (EP): se le aplica el rendimiento del insumo.',
    insumo: 'Insumo',
    cantidad: 'Cantidad',
    base: 'Se mide',
    bases: { AP: 'Tal como se compra (AP)', EP: 'Ya limpio (EP)' },
    excluida: 'Excluida (no suma, se conserva)',
    quitar: 'Quitar',
    anadir: 'Añadir insumo',
    desde: 'Vale desde',
    nota: 'Nota del cambio',
    guardar: 'Guardar receta',
    guardando: 'Guardando…',
    comboSinReceta: 'Un combo no tiene receta: se arma con componentes, desde su ficha.',
    compradoSinReceta: 'Un insumo comprado no tiene receta: solo una preparación se hace con otros insumos.',
  },

  /** Pantalla 15: el historial de versiones de una receta en una sucursal. */
  versionesDeReceta: {
    enlace: 'Versiones',
    titulo: 'Versiones de la receta',
    ayuda: 'Cada vez que se guarda la receta queda una versión con su fecha. Las anteriores no se borran: los costeos de los meses pasados siguen usando la que mandaba entonces.',
    en: 'En',
    desde: 'Vale desde el',
    mandaHoy: 'Manda hoy',
    masNueva: 'La más nueva',
    sinReceta: 'Deja el producto sin receta',
    hoySinReceta: 'Hoy este producto no tiene receta vigente en esta sucursal.',
    hayFutura: 'La versión más nueva todavía no manda: empieza a valer más adelante.',
    nota: 'Nota',
    sinNota: 'Se guardó sin nota.',
    sinLineas: 'Esta versión no tiene líneas: deja el producto sin receta hasta que otra la reemplace.',
    lineas: 'Insumos de esta versión',
    insumo: 'Insumo',
    cantidad: 'Cantidad',
    base: 'Se mide',
    excluida: 'Excluida: no suma',
    vacio: 'Esta receta todavía no tiene ninguna versión.',
    vacioAyuda: 'Guarda la receta del producto en esta sucursal y su primera versión aparecerá aquí.',
  },

  /** Pantalla 16: propagar la receta a otras sucursales, y deshacerlo. */
  propagacion: {
    enlace: 'Propagar',
    titulo: 'Propagar la receta',
    ayuda: 'Copia la receta de esta sucursal a las que elijas. En cada una queda una versión nueva desde hoy; lo que costearon antes no cambia.',
    desde: 'Desde',
    aDonde: '¿A qué sucursales?',
    // R11: el aviso dice qué se pierde, no «ten cuidado».
    avisoPersonalizadas:
      'Las sucursales marcadas como «Tiene receta propia» ya ajustaron la suya. Propagar sobre ellas la reemplaza: su versión anterior queda en el historial, pero deja de mandar.',
    tieneReceta: 'Tiene receta propia',
    sinReceta: 'Todavía sin receta',
    propagar: 'Propagar a las elegidas',
    propagando: 'Propagando…',
    ningunaElegida: 'Elige al menos una sucursal.',
    preguntaPersonalizadas:
      'Vas a reemplazar la receta propia de {n}. Quedará en su historial, pero dejará de mandar. ¿Propagar de todos modos?',
    confirmarPropagar: 'Sí, propagar',
    sinDestinos: 'Este producto no está en ninguna otra sucursal: no hay a dónde propagar.',
    historial: 'Lo que ya se propagó',
    sinHistorial: 'Todavía no se ha propagado nunca.',
    cuando: 'Cuándo',
    sucursales: 'Sucursales',
    estado: 'Estado',
    aplicada: 'Aplicada',
    revertida: 'Revertida',
    revertir: 'Revertir',
    revirtiendo: 'Revirtiendo…',
    preguntaRevertir:
      'Revertir devuelve a cada sucursal la receta que tenía antes, como versión nueva desde hoy. No borra nada y no cambia lo ya costeado.',
    confirmarRevertir: 'Sí, revertir',
  },

  /** Pantalla 17: el libro de movimientos de una sucursal. */
  movimientos: {
    titulo: 'Movimientos',
    ayuda: 'Todo lo que entró y salió de esta sucursal, lo más reciente primero. Nada se edita ni se borra: un error se arregla con un movimiento de signo contrario, y los dos quedan.',
    filtrar: 'Filtrar',
    insumo: 'Insumo',
    todosLosInsumos: 'Todos los insumos',
    tipo: 'Tipo',
    todosLosTipos: 'Todos los tipos',
    desde: 'Desde',
    hasta: 'Hasta',
    limpiar: 'Quitar filtros',
    fecha: 'Fecha',
    cantidad: 'Cantidad',
    importe: 'Importe',
    nota: 'Nota',
    estado: 'Estado',
    verMas: 'Ver más',
    // El importe es una MAGNITUD: el signo vive en la cantidad (ADR-009 §2). Sin
    // esta línea, una corrección de −100 kg con importe 115,00 se lee como si
    // hubiera sumado 115, y quien sume la columna a ojo se equivoca.
    importeSinSigno:
      'El importe es siempre en positivo: quien manda es la cantidad. En una corrección, la cantidad va en negativo y su importe se resta, aunque aquí se lea sin el signo.',
    corregido: 'Corregido',
    correccion: 'Es una corrección',
    // D-16.18: las compras anteriores al modelo de IVA no tienen desglose, y eso
    // se dice; un importe sin decir si es bruto o neto es peor que no enseñarlo.
    sinDesglose: 'Sin desglose de IVA',
    vacio: 'No hay movimientos con esos filtros.',
    vacioAyuda: 'Prueba con otro insumo, otro tipo o un rango de fechas más amplio.',
    tipos: {
      COMPRA: 'Compra',
      TRANSFERENCIA_ENTRADA: 'Transferencia recibida',
      TRANSFERENCIA_SALIDA: 'Transferencia enviada',
      PRODUCCION: 'Producción',
      MERMA: 'Merma',
      AJUSTE: 'Ajuste',
      CONSUMO_POR_VENTA: 'Consumo por venta',
    } as Record<string, string>,
  },

  /** Pantalla 19: corregir un movimiento del libro. */
  correccion: {
    enlace: 'Corregir',
    titulo: 'Corregir un movimiento',
    // R3: la corrección no edita ni borra. Decirlo aquí evita que alguien espere
    // que la fila original desaparezca.
    ayuda: 'Corregir no borra ni cambia la fila original: escribe otra de signo contrario, y las dos se quedan en el libro. Así el saldo vuelve a su sitio y queda por qué.',
    elMovimiento: 'El movimiento que se va a corregir',
    fecha: 'Fecha',
    tipo: 'Tipo',
    insumo: 'Insumo',
    cantidad: 'Cantidad',
    importe: 'Importe',
    notaOriginal: 'Nota',
    queDeja: 'Lo que va a quedar',
    // Sin calcular nada: se describe la operación, no se adelanta el número.
    queDejaAyuda:
      'Una fila nueva, con la misma fecha y el mismo insumo, y la cantidad al revés. El saldo de este insumo vuelve a como estaba antes del movimiento.',
    motivo: 'Por qué se corrige',
    motivoAyuda: 'Lo que explique la corrección a quien mire el libro dentro de seis meses. Es lo único que se escribe a mano.',
    corregir: 'Registrar la corrección',
    corrigiendo: 'Registrando…',
    yaCorregido: 'Este movimiento ya se corrigió. Un movimiento se corrige una sola vez.',
    esCorreccion: 'Esto ya es una corrección, y una corrección no se corrige. Si sigue sin cuadrar, registra un ajuste.',
    hecho: 'Corrección registrada. El libro ya la enseña.',
  },

  /** Pantalla 18: registrar una compra, una merma o un ajuste. */
  movimientoNuevo: {
    enlace: 'Registrar',
    titulo: 'Registrar movimiento',
    ayuda: 'Lo que entró o salió de esta sucursal. Se anota una vez y no se edita: si te equivocas, se corrige con otro movimiento y los dos quedan.',
    queEs: '¿Qué pasó?',
    tipos: {
      COMPRA: 'Llegó una compra',
      MERMA: 'Se perdió producto',
      AJUSTE: 'Corregir el stock tras contar',
    } as Record<string, string>,
    // Cada tipo pregunta lo que ese tipo significa: el signo lo pone el dominio
    // (`movimiento.ts`), aquí nunca se resta nada por cuenta propia.
    ayudasDeTipo: {
      COMPRA: 'Cuánto entró y cuánto se pagó por ello, tal como dice la factura.',
      MERMA: 'Cuánto se perdió. Escríbelo en positivo: el sistema ya sabe que resta.',
      AJUSTE: 'La diferencia que hay que aplicar. En positivo si sobra, con el menos delante si falta.',
    } as Record<string, string>,
    insumo: 'Insumo',
    elijaInsumo: 'Elige un insumo',
    cantidades: {
      COMPRA: 'Cuánto entró',
      MERMA: 'Cuánto se perdió',
      AJUSTE: 'Diferencia (+ sobra · − falta)',
    } as Record<string, string>,
    articulo: 'Presentación comprada',
    sinArticulo: 'Sin presentación (usa el IVA del grupo)',
    articuloAyuda: 'La presentación dice en qué se compró y con qué IVA. Si la eliges, no hace falta escribir la tarifa.',
    total: 'Total de la factura (con IVA)',
    totalAyuda: 'Escribe lo que dice la factura, con IVA incluido. El sistema le quita el IVA si tu company lo recupera.',
    iva: 'IVA de esta factura (%)',
    ivaAyuda: 'Solo si esta factura lleva una tarifa distinta de la de la presentación. Si lo dejas vacío, manda la de la presentación o la del grupo.',
    fecha: 'Cuándo ocurrió',
    fechaAyuda: 'La fecha del hecho, no la de hoy. No puede ser futura ni caer en un mes ya cerrado.',
    nota: 'Nota',
    notaAyuda: 'Número de factura, proveedor, qué pasó. Lo que ayude a entenderlo dentro de seis meses.',
    registrar: 'Registrar movimiento',
    registrando: 'Registrando…',
    sinInsumos: 'No hay insumos en el catálogo todavía. Crea uno antes de registrar movimientos.',
    hecho: 'Movimiento registrado.',
    otro: 'Registrar otro',
    verLibro: 'Ver el libro',
  },

  /** Pantalla 13: los componentes de un combo. */
  componentes: {
    titulo: 'Componentes',
    editar: 'Editar componentes',
    editarTitulo: 'Componentes del combo',
    ayuda: 'Los productos con receta que forman el combo y cuántos de cada uno. Se guarda la lista entera: lo que quites deja de ser componente.',
    producto: 'Producto',
    cantidad: 'Cantidad',
    quitar: 'Quitar',
    anadir: 'Añadir componente',
    guardar: 'Guardar componentes',
    guardando: 'Guardando…',
    sinFilas: 'El combo no tiene componentes: su costo no se puede calcular hasta tenerlos.',
    sinOpciones: 'No hay productos con receta activos para componer el combo.',
    noEsCombo: 'Este producto tiene receta, no componentes: solo un combo se arma con otros productos.',
    vacio: 'Todavía no tiene componentes.',
    vacioAyuda: 'Un combo se arma con productos que tienen receta; su costo es el de ellos.',
    sinComponentes: 'Sin componentes: el costo no se puede calcular. Añade sus componentes para verlo.',
  },

  /** Pantalla 10: sugerir un precio de referencia. */
  precioNuevo: {
    titulo: 'Sugerir precio',
    ayuda: 'Queda por confirmar: no cambia ningún costo hasta que alguien lo confirme.',
    insumo: 'Insumo',
    eligeInsumo: 'Elige un insumo',
    sinInsumos: 'No hay insumos activos.',
    sinInsumosAyuda: 'Da de alta el insumo antes de ponerle precio.',
    vigente: 'Vigente hoy:',
    sinVigente: 'Todavía no tiene ningún precio confirmado.',
    presentacion: 'Presentación',
    sinPresentaciones: 'Este insumo no tiene presentaciones de compra activas: un precio de compra necesita saber cuánto trae lo que se compra.',
    crearPresentacion: 'Crear presentación',
    precio: 'Precio de la presentación en la factura, con IVA',
    iva: 'IVA de esta factura (%)',
    ivaAyuda: 'Vacío: el de la presentación. Escribe 0 si esta compra fue exenta.',
    costoEstandar: 'Costo estándar por',
    costoEstandarAyuda: 'Una preparación se costea con su costo estándar, no con lo que costó cada lote (R10). No lleva IVA de compra.',
    desde: 'Vigente desde',
    nota: 'Nota',
    crear: 'Sugerir precio',
    creando: 'Enviando…',
  },

  /** Pantalla 8: las presentaciones de compra de un insumo. */
  articulo: {
    nuevo: 'Nueva presentación',
    nuevoTitulo: 'Nueva presentación de compra',
    editarTitulo: 'Editar presentación',
    nombre: 'Nombre',
    marca: 'Marca',
    proveedor: 'Proveedor',
    presentacion: 'Cuánto trae',
    unidad: 'En qué unidad',
    factor: 'Cuántas unidades de uso trae una:',
    fijos: 'Lo que trae y su unidad no se pueden cambiar después: convierten cada compra a unidades de uso. Si cambia la presentación, es otra.',
    noEditables: 'No se pueden cambiar:',
    iva: 'IVA de compra de la factura (%)',
    estado: 'Estado',
    activo: 'Activa',
    archivado: 'Archivada',
    crear: 'Crear presentación',
    creando: 'Creando…',
    guardar: 'Guardar cambios',
    guardando: 'Guardando…',
  },

  /** Pantalla 7: los grupos de insumos y su tarifa de IVA. */
  grupos: {
    titulo: 'Grupos',
    ayuda: 'Cómo se agrupan los insumos, y la tarifa de IVA que heredan sus compras sin artículo.',
    nuevo: 'Nuevo grupo',
    editar: 'Editar grupo',
    nombre: 'Grupo',
    iva: 'IVA de compra (%)',
    ivaAyuda:
      'Déjalo vacío si el grupo no define tarifa: entonces manda la del artículo, y si tampoco la hay, la compra se rechaza con su motivo. Vacío no es cero.',
    noDefine: 'No define',
    crear: 'Crear grupo',
    guardar: 'Guardar cambios',
    guardando: 'Guardando…',
    vacio: 'Todavía no hay grupos.',
    vacioAyuda: 'Un grupo junta insumos parecidos —lácteos, verduras— y puede fijar su tarifa de IVA.',
    noEncontrado: 'Ese grupo no existe en tu empresa.',
    noEncontradoAyuda: 'Vuelve a la lista de grupos y elige uno.',
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
    // La salida de quien no puede volver a la pantalla de la que se suele venir:
    // BODEGA registra movimientos y no puede leer el libro (§4.3).
    volverAlInicio: 'Volver al inicio',
    cancelar: 'Cancelar',
    sinPermiso: 'Tu usuario no tiene acceso a esta pantalla.',
    sinPermisoAyuda: 'Si crees que debería tenerlo, pídeselo a quien administra el sistema.',
    sesionCaducada: 'Tu sesión se cerró. Vuelve a entrar.',
    // D-16.2: un mes que nadie ha trabajado no es un error, es un estado.
    mesSinAbrir: 'Este mes todavía no tiene datos en esta sucursal.',
    mesSinAbrirAyuda: 'Cuando se carguen sus ventas o sus movimientos, aquí aparecerán sus números.',
  },
} as const;
