'use client';

// Todos los roles leen el catálogo —BODEGA incluido, para contar—; el costo de
// uso solo lo pide la página si la sesión tiene `pricing.read`.
import { seccion } from '../../../componentes/armazon/Permitido';

export default seccion('catalog.read');
