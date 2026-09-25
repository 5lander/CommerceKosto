'use client';

// Todos los roles leen la reposición —BODEGA incluido—; quien además lee la
// analítica ve el resumen. La página elige; la API es la frontera.
import { seccion } from '../../../componentes/armazon/Permitido';

export default seccion('replenishment.read');
