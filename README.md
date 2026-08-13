# Almacén React + Supabase

Aplicación React preparada para Vercel con inicio de sesión por Supabase Auth.

La app permite:

- Ver bases de datos / almacenes creados
- Crear una nueva base con nombre y ubicación
- Borrar una base con confirmación, eliminando sus datos asociados
- Entrar a una base y configurarla
- Dar de alta, editar, seleccionar y borrar artículos
- Importar artículos desde Excel
- Dar de alta, seleccionar y borrar usuarios locales con roles Administrador, Repositor y Operario
- Configurar estanterías por módulos, estantes y cantidad de baldas

## Campos

### Base / almacén

- Nombre
- Ubicación
- Descripción

### Artículos

- Código de artículo
- Código de cliente
- Descripción
- SKU
- Sufijos por balda: `01`, `02`, `03`, `04`
- Capacidad por sufijo
- Capacidad total calculada desde los sufijos

### Importación Excel

La plantilla está en `plantillas/plantilla_importacion_articulos.xlsx`.

Columnas esperadas:

- `codigo_articulo`
- `codigo_cliente`
- `descripcion`
- `sku`
- `sufijo`
- `capacidad`

Cada fila representa una balda/sufijo. Si varias filas tienen el mismo `sku`, se importan como un solo artículo con varios sufijos.

### Usuarios operativos

- Nombre
- Email
- Rol
- PIN para app local
- Estado activo/inactivo

### Estanterías

- Módulos de estantería
- 8 estantes fijos por módulo
- Máximo 8 baldas por estante
- Módulos numerados como Módulo 1, Módulo 2, etc.
- Cantidad de baldas usadas por estante, ocupando siempre el ancho completo del estante

## Configuración de Supabase

1. En Supabase, abre **SQL Editor**.
2. Ejecuta el contenido de `supabase/schema.sql`.
3. En **Authentication > Users**, crea los usuarios que podrán entrar.
4. Copia tu **Project URL** y tu **anon public key**.

Esta versión usa tablas propias con prefijo `almacen_`:

- `almacen_bases`
- `almacen_articulos`
- `almacen_operadores`
- `almacen_modulos`
- `almacen_estantes`

Si venías de una versión anterior, ejecuta el SQL actualizado antes de probar la web. Esto evita conflictos con tablas antiguas que pudieran tener otro tipo de dato.

## Configuración local

```bash
npm install
cp .env.example .env
npm run dev
```

Edita `.env`:

```bash
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
```

## Deploy en Vercel

1. Sube esta carpeta a GitHub.
2. Importa el proyecto en Vercel.
3. En Vercel, agrega estas variables de entorno:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

## Seguridad

La app usa Supabase Auth. La tabla tiene Row Level Security activado y solo usuarios autenticados pueden leer, crear, editar o borrar artículos.
