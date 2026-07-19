create extension if not exists "pgcrypto";

create table if not exists public.almacen_bases (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  ubicacion text not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.almacen_articulos (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  codigo_articulo text not null,
  codigo_cliente text,
  sku text not null,
  descripcion text not null,
  cantidad_baldas integer not null default 1 check (cantidad_baldas > 0),
  capacidad_balda integer not null default 1 check (capacidad_balda > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.almacen_operadores (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  nombre text not null,
  email text not null,
  rol text not null default 'operador',
  pin text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.almacen_modulos (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  nombre text not null,
  orden integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.almacen_estantes (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.almacen_modulos(id) on delete cascade,
  numero integer not null check (numero between 1 and 8),
  cantidad_baldas integer not null default 0 check (cantidad_baldas between 0 and 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists almacen_bases_nombre_key on public.almacen_bases (nombre);
create unique index if not exists almacen_articulos_codigo_key on public.almacen_articulos (almacen_id, codigo_articulo);
create unique index if not exists almacen_articulos_sku_key on public.almacen_articulos (almacen_id, sku);
create unique index if not exists almacen_operadores_email_key on public.almacen_operadores (almacen_id, email);
create unique index if not exists almacen_modulos_orden_key on public.almacen_modulos (almacen_id, orden);
create unique index if not exists almacen_estantes_modulo_numero_key on public.almacen_estantes (modulo_id, numero);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists almacen_bases_set_updated_at on public.almacen_bases;
create trigger almacen_bases_set_updated_at
before update on public.almacen_bases
for each row execute function public.set_updated_at();

drop trigger if exists almacen_articulos_set_updated_at on public.almacen_articulos;
create trigger almacen_articulos_set_updated_at
before update on public.almacen_articulos
for each row execute function public.set_updated_at();

drop trigger if exists almacen_operadores_set_updated_at on public.almacen_operadores;
create trigger almacen_operadores_set_updated_at
before update on public.almacen_operadores
for each row execute function public.set_updated_at();

drop trigger if exists almacen_modulos_set_updated_at on public.almacen_modulos;
create trigger almacen_modulos_set_updated_at
before update on public.almacen_modulos
for each row execute function public.set_updated_at();

drop trigger if exists almacen_estantes_set_updated_at on public.almacen_estantes;
create trigger almacen_estantes_set_updated_at
before update on public.almacen_estantes
for each row execute function public.set_updated_at();

alter table public.almacen_bases enable row level security;
alter table public.almacen_articulos enable row level security;
alter table public.almacen_operadores enable row level security;
alter table public.almacen_modulos enable row level security;
alter table public.almacen_estantes enable row level security;

drop policy if exists "Usuarios autenticados gestionan bases de almacen" on public.almacen_bases;
drop policy if exists "Usuarios autenticados gestionan articulos de almacen" on public.almacen_articulos;
drop policy if exists "Usuarios autenticados gestionan operadores de almacen" on public.almacen_operadores;
drop policy if exists "Usuarios autenticados gestionan modulos de almacen" on public.almacen_modulos;
drop policy if exists "Usuarios autenticados gestionan estantes de almacen" on public.almacen_estantes;

create policy "Usuarios autenticados gestionan bases de almacen"
on public.almacen_bases for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados gestionan articulos de almacen"
on public.almacen_articulos for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados gestionan operadores de almacen"
on public.almacen_operadores for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados gestionan modulos de almacen"
on public.almacen_modulos for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados gestionan estantes de almacen"
on public.almacen_estantes for all
to authenticated
using (true)
with check (true);
