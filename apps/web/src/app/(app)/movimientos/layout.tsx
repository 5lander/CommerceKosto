'use client';

// BODEGA no tiene `inventory.read`: del libro se despeja el consumo teórico, y de
// ahí la receta (CLAUDE.md §4.3). Escribe movimientos, pero no los lee.
import { seccion } from '../../../componentes/armazon/Permitido';

export default seccion('inventory.read');
