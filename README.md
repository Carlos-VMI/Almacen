# Almacén React + Supabase

Aplicación React preparada para Vercel con inicio de sesión por Supabase Auth y CRUD de artículos.

## Campos

- Código de artículo
- Código de cliente
- SKU
- Descripción
- Cantidad de baldas
- Capacidad por balda
- Capacidad total calculada

## Configuración de Supabase

1. En Supabase, abre **SQL Editor**.
2. Ejecuta el contenido de `supabase/schema.sql`.
3. En **Authentication > Users**, crea los usuarios que podrán entrar.
4. Copia tu **Project URL** y tu **anon public key**.

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
