# Estándar Stock Karam

Pedido sugerido de repuestos para La Rioja y Catamarca. Página estática (GitHub Pages) con datos en Supabase.

- `index.html`: la aplicación.
- `config.js`: dirección y clave pública del proyecto de Supabase.
- `supabase-shim.js`: conecta la app con Supabase (tabla `docs` y bucket `archivos`).
- `supabase/setup.sql`: crea la tabla, las vistas `v_pedidos`, `v_stock`, `v_ventas`, la seguridad y el bucket.

Los datos del negocio NO se suben a GitHub: se cargan desde la app (Parámetros > Restaurar respaldo).
