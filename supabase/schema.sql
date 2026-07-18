create extension if not exists "pgcrypto";

create table if not exists public.almacenes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  ubicacion text not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.articulos (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid references public.almacenes(id) on delete cascade,
  codigo_articulo text not null,
  codigo_cliente text,
  sku text not null,
  descripcion text not null,
  cantidad_baldas integer not null default 1 check (cantidad_baldas > 0),
  capacidad_balda integer not null default 1 check (capacidad_balda > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.articulos
  add column if not exists almacen_id uuid references public.almacenes(id) on delete cascade,
  add column if not exists codigo_cliente text,
  add column if not exists cantidad_baldas integer not null default 1 check (cantidad_baldas > 0),
  add column if not exists capacidad_balda integer not null default 1 check (capacidad_balda > 0);

create table if not exists public.operadores (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacenes(id) on delete cascade,
  nombre text not null,
  email text not null,
  rol text not null default 'operador',
  pin text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.modulos_estanteria (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacenes(id) on delete cascade,
  nombre text not null,
  orden integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.estantes_estanteria (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.modulos_estanteria(id) on delete cascade,
  numero integer not null check (numero > 0),
  cantidad_baldas integer not null default 0 check (cantidad_baldas >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists almacenes_nombre_key on public.almacenes (nombre);
create unique index if not exists articulos_almacen_codigo_articulo_key on public.articulos (almacen_id, codigo_articulo);
create unique index if not exists articulos_almacen_sku_key on public.articulos (almacen_id, sku);
create unique index if not exists operadores_almacen_email_key on public.operadores (almacen_id, email);
create unique index if not exists modulos_almacen_orden_key on public.modulos_estanteria (almacen_id, orden);
create unique index if not exists estantes_modulo_numero_key on public.estantes_estanteria (modulo_id, numero);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists almacenes_set_updated_at on public.almacenes;
create trigger almacenes_set_updated_at
before update on public.almacenes
for each row execute function public.set_updated_at();

drop trigger if exists articulos_set_updated_at on public.articulos;
create trigger articulos_set_updated_at
before update on public.articulos
for each row execute function public.set_updated_at();

drop trigger if exists operadores_set_updated_at on public.operadores;
create trigger operadores_set_updated_at
before update on public.operadores
for each row execute function public.set_updated_at();

drop trigger if exists modulos_set_updated_at on public.modulos_estanteria;
create trigger modulos_set_updated_at
before update on public.modulos_estanteria
for each row execute function public.set_updated_at();

drop trigger if exists estantes_set_updated_at on public.estantes_estanteria;
create trigger estantes_set_updated_at
before update on public.estantes_estanteria
for each row execute function public.set_updated_at();

alter table public.almacenes enable row level security;
alter table public.articulos enable row level security;
alter table public.operadores enable row level security;
alter table public.modulos_estanteria enable row level security;
alter table public.estantes_estanteria enable row level security;

drop policy if exists "Usuarios autenticados pueden gestionar almacenes" on public.almacenes;
drop policy if exists "Usuarios autenticados pueden gestionar articulos" on public.articulos;
drop policy if exists "Usuarios autenticados pueden gestionar operadores" on public.operadores;
drop policy if exists "Usuarios autenticados pueden gestionar modulos" on public.modulos_estanteria;
drop policy if exists "Usuarios autenticados pueden gestionar estantes" on public.estantes_estanteria;

create policy "Usuarios autenticados pueden gestionar almacenes"
on public.almacenes for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados pueden gestionar articulos"
on public.articulos for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados pueden gestionar operadores"
on public.operadores for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados pueden gestionar modulos"
on public.modulos_estanteria for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados pueden gestionar estantes"
on public.estantes_estanteria for all
to authenticated
using (true)
with check (true);
