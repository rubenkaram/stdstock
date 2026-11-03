# Estándar Stock Karam

Pedido sugerido de repuestos para La Rioja y Catamarca. Página estática (GitHub Pages) con datos en Supabase.

- `index.html`: la aplicación.
- `stock-actividad.html`: pestaña Stock por actividad (se abre dentro de la app; sin datos, las cargas se guardan en Supabase).
- `config.js`: dirección y clave pública del proyecto de Supabase.
- `supabase-shim.js`: conecta la app con Supabase (tabla `docs` y bucket `archivos`).
- `supabase/setup.sql`: crea la tabla, las vistas `v_pedidos`, `v_stock`, `v_ventas`, la seguridad y el bucket.
- `supabase/usuarios.sql`: usuarios y permisos (sucursales y secciones por usuario; solo el administrador los modifica). Correr una vez en el SQL Editor.

Los datos del negocio NO se suben a GitHub: se cargan desde la app (Parámetros > Restaurar respaldo).
