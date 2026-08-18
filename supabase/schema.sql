create extension if not exists "pgcrypto";

drop table if exists public.almacen_sync;

create table if not exists public.almacen_bases (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  ubicacion text not null,
  descripcion text,
  ancho_estante_cm numeric not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_bases
  add column if not exists ancho_estante_cm numeric not null default 100;

create table if not exists public.almacen_articulos (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  codigo_articulo text not null,
  codigo_cliente text,
  sku text not null,
  descripcion text not null,
  sufijos jsonb not null default '[{"sufijo":"01","capacidad":1}]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_articulos
  drop column if exists cantidad_baldas,
  drop column if exists capacidad_balda,
  add column if not exists sufijos jsonb not null default '[{"sufijo":"01","capacidad":1}]'::jsonb;

create table if not exists public.almacen_operadores (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  nombre text not null,
  apellido text,
  email text,
  rol text not null default 'operario',
  pin text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_operadores
  add column if not exists apellido text,
  alter column email drop not null;

create table if not exists public.almacen_admins (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  email text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_admins
  drop column if exists credential;

create table if not exists public.almacen_configuracion (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  notificacion_reposicion_email text,
  enviar_reporte_orden boolean not null default true,
  enviar_resumen_diario boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_configuracion
  add column if not exists enviar_reporte_orden boolean not null default true,
  add column if not exists enviar_resumen_diario boolean not null default false;

create table if not exists public.almacen_notificacion_emails (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  categoria text not null default 'reposicion',
  email text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_notificacion_emails
  add column if not exists categoria text not null default 'reposicion',
  add column if not exists activo boolean not null default true;

alter table public.almacen_notificacion_emails
  drop constraint if exists almacen_notificacion_emails_categoria_check;

alter table public.almacen_notificacion_emails
  add constraint almacen_notificacion_emails_categoria_check
  check (categoria in ('reposicion', 'informes'));

insert into public.almacen_notificacion_emails (almacen_id, categoria, email)
select almacen_id, 'reposicion', lower(trim(notificacion_reposicion_email))
from public.almacen_configuracion
where nullif(trim(coalesce(notificacion_reposicion_email, '')), '') is not null
on conflict do nothing;

create table if not exists public.almacen_iot_controladores (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  nombre text not null,
  ip text not null,
  tipo_tira text not null default 'WS2812B',
  leds_por_metro integer not null default 60 check (leds_por_metro > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.almacen_cubetas_catalogo (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  ancho_cm numeric not null check (ancho_cm > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.almacen_modulos (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacen_bases(id) on delete cascade,
  nombre text not null,
  orden integer not null default 1,
  ancho_estante_cm numeric,
  controlador_id uuid references public.almacen_iot_controladores(id) on delete set null,
  canal_led text not null default '',
  routing_mode text not null default 'direct' check (routing_mode in ('direct', 'zigzag')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_modulos
  add column if not exists ancho_estante_cm numeric,
  add column if not exists controlador_id uuid references public.almacen_iot_controladores(id) on delete set null,
  add column if not exists canal_led text not null default '',
  add column if not exists routing_mode text not null default 'direct';

alter table public.almacen_modulos
  drop constraint if exists almacen_modulos_canal_led_check;

alter table public.almacen_modulos
  alter column canal_led type text using coalesce(canal_led::text, ''),
  alter column canal_led set default '',
  alter column canal_led set not null;

alter table public.almacen_modulos
  drop constraint if exists almacen_modulos_routing_mode_check,
  add constraint almacen_modulos_routing_mode_check
  check (routing_mode in ('direct', 'zigzag'));

create table if not exists public.almacen_estantes (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.almacen_modulos(id) on delete cascade,
  numero integer not null check (numero between 1 and 8),
  cantidad_baldas integer not null default 0 check (cantidad_baldas between 0 and 8),
  esp32_ip text,
  total_leds integer not null default 60 check (total_leds >= 0),
  cajones jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.almacen_estantes
  add column if not exists esp32_ip text,
  add column if not exists total_leds integer not null default 60,
  add column if not exists cajones jsonb not null default '[]'::jsonb;

create unique index if not exists almacen_bases_nombre_key on public.almacen_bases (nombre);
create unique index if not exists almacen_articulos_codigo_key on public.almacen_articulos (almacen_id, codigo_articulo);
create unique index if not exists almacen_articulos_sku_key on public.almacen_articulos (almacen_id, sku);
create unique index if not exists almacen_operadores_email_key on public.almacen_operadores (almacen_id, email);
create unique index if not exists almacen_admins_username_key on public.almacen_admins (username);
create unique index if not exists almacen_admins_email_key on public.almacen_admins (email);
create unique index if not exists almacen_configuracion_almacen_key on public.almacen_configuracion (almacen_id);
drop index if exists almacen_notificacion_emails_almacen_email_key;
create unique index if not exists almacen_notificacion_emails_almacen_categoria_email_key on public.almacen_notificacion_emails (almacen_id, categoria, email);
create unique index if not exists almacen_iot_controladores_nombre_key on public.almacen_iot_controladores (almacen_id, nombre);
create unique index if not exists almacen_cubetas_catalogo_codigo_key on public.almacen_cubetas_catalogo (almacen_id, codigo);
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

drop trigger if exists almacen_admins_set_updated_at on public.almacen_admins;
create trigger almacen_admins_set_updated_at
before update on public.almacen_admins
for each row execute function public.set_updated_at();

drop trigger if exists almacen_configuracion_set_updated_at on public.almacen_configuracion;
create trigger almacen_configuracion_set_updated_at
before update on public.almacen_configuracion
for each row execute function public.set_updated_at();

drop trigger if exists almacen_notificacion_emails_set_updated_at on public.almacen_notificacion_emails;
create trigger almacen_notificacion_emails_set_updated_at
before update on public.almacen_notificacion_emails
for each row execute function public.set_updated_at();

drop trigger if exists almacen_iot_controladores_set_updated_at on public.almacen_iot_controladores;
create trigger almacen_iot_controladores_set_updated_at
before update on public.almacen_iot_controladores
for each row execute function public.set_updated_at();

drop trigger if exists almacen_cubetas_catalogo_set_updated_at on public.almacen_cubetas_catalogo;
create trigger almacen_cubetas_catalogo_set_updated_at
before update on public.almacen_cubetas_catalogo
for each row execute function public.set_updated_at();

update public.almacen_operadores
set rol = 'operario'
where rol = 'operador';

update public.almacen_operadores
set rol = 'administrador'
where rol = 'admin';

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
alter table public.almacen_admins enable row level security;
alter table public.almacen_configuracion enable row level security;
alter table public.almacen_notificacion_emails enable row level security;
alter table public.almacen_iot_controladores enable row level security;
alter table public.almacen_cubetas_catalogo enable row level security;
alter table public.almacen_modulos enable row level security;
alter table public.almacen_estantes enable row level security;

drop policy if exists "Usuarios autenticados gestionan bases de almacen" on public.almacen_bases;
drop policy if exists "Usuarios autenticados gestionan articulos de almacen" on public.almacen_articulos;
drop policy if exists "Usuarios autenticados gestionan operadores de almacen" on public.almacen_operadores;
drop policy if exists "Usuarios autenticados gestionan administradores web" on public.almacen_admins;
drop policy if exists "Lectura publica limitada para login por username" on public.almacen_admins;
drop policy if exists "Usuarios autenticados gestionan configuracion de almacen" on public.almacen_configuracion;
drop policy if exists "Usuarios autenticados gestionan emails de reposicion" on public.almacen_notificacion_emails;
drop policy if exists "Lectura publica de emails activos de reposicion" on public.almacen_notificacion_emails;
drop policy if exists "Usuarios autenticados gestionan controladores iot de almacen" on public.almacen_iot_controladores;
drop policy if exists "Usuarios autenticados gestionan catalogo de cubetas" on public.almacen_cubetas_catalogo;
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

create policy "Usuarios autenticados gestionan administradores web"
on public.almacen_admins for all
to authenticated
using (true)
with check (true);

create policy "Lectura publica limitada para login por username"
on public.almacen_admins for select
to anon
using (activo = true);

create policy "Usuarios autenticados gestionan configuracion de almacen"
on public.almacen_configuracion for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados gestionan emails de reposicion"
on public.almacen_notificacion_emails for all
to authenticated
using (true)
with check (true);

create policy "Lectura publica de emails activos de reposicion"
on public.almacen_notificacion_emails for select
to anon
using (categoria = 'reposicion' and activo = true);

revoke all on public.almacen_admins from anon;
grant select (username, email, activo) on public.almacen_admins to anon;
grant select (id, almacen_id, categoria, email, activo, created_at, updated_at) on public.almacen_notificacion_emails to anon;

create policy "Usuarios autenticados gestionan controladores iot de almacen"
on public.almacen_iot_controladores for all
to authenticated
using (true)
with check (true);

create policy "Usuarios autenticados gestionan catalogo de cubetas"
on public.almacen_cubetas_catalogo for all
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

notify pgrst, 'reload schema';
