create extension if not exists "pgcrypto";

create table if not exists public.articulos (
  id uuid primary key default gen_random_uuid(),
  codigo_articulo text not null,
  codigo_cliente text,
  sku text not null,
  descripcion text not null,
  cantidad_baldas integer not null check (cantidad_baldas > 0),
  capacidad_balda integer not null check (capacidad_balda > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists articulos_codigo_articulo_key
  on public.articulos (codigo_articulo);

create unique index if not exists articulos_sku_key
  on public.articulos (sku);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists articulos_set_updated_at on public.articulos;

create trigger articulos_set_updated_at
before update on public.articulos
for each row
execute function public.set_updated_at();

alter table public.articulos enable row level security;

drop policy if exists "Usuarios autenticados pueden leer articulos" on public.articulos;
drop policy if exists "Usuarios autenticados pueden crear articulos" on public.articulos;
drop policy if exists "Usuarios autenticados pueden editar articulos" on public.articulos;
drop policy if exists "Usuarios autenticados pueden borrar articulos" on public.articulos;

create policy "Usuarios autenticados pueden leer articulos"
on public.articulos for select
to authenticated
using (true);

create policy "Usuarios autenticados pueden crear articulos"
on public.articulos for insert
to authenticated
with check (true);

create policy "Usuarios autenticados pueden editar articulos"
on public.articulos for update
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados pueden borrar articulos"
on public.articulos for delete
to authenticated
using (true);
