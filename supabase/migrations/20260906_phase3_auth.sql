-- Phase 3: Authentication + RBAC foundation
-- Safe to run after the profiles table/trigger and incidents table exist.

create type public.user_role as enum (
  'citizen',
  'responder',
  'hospital',
  'shelter',
  'command_center',
  'admin'
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'citizen',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

-- Do not grant browser users permission to change their own role.
-- Role changes must be performed by a trusted backend/admin workflow.

grant select on public.profiles to authenticated;

grant select, insert, update, delete on public.profiles to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    'citizen'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

alter table public.incidents
add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists incidents_user_id_idx
on public.incidents(user_id);

alter table public.incidents enable row level security;

grant select, insert, update, delete on public.incidents to service_role;
