-- Studio d'invitations : commandes de la vitrine et licences des invitations livrées
-- À coller une fois dans Supabase → SQL Editor → Run (après supabase.sql et equipe.sql).
-- Les visiteurs du site envoient une commande (et leurs photos) ; l'admin de l'équipe les lit avec sa clé admin.

create table if not exists public.inv_commandes (
  id bigserial primary key,
  numero text unique not null,
  jeton text not null,
  modele text default '',
  modele_titre text default '',
  client jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  statut text not null default 'nouvelle',
  notes text default '',
  projet text default '',
  licence text default '',
  cree timestamptz default now(),
  maj timestamptz default now()
);
create index if not exists inv_commandes_cree on public.inv_commandes(cree desc);

create table if not exists public.inv_licences (
  code text primary key,
  evt text not null,
  client text default '',
  commande text default '',
  statut text not null default 'active',
  cree timestamptz default now(),
  change timestamptz
);
create index if not exists inv_licences_evt on public.inv_licences(evt);

alter table public.inv_commandes enable row level security;
alter table public.inv_licences enable row level security;
revoke all on public.inv_commandes, public.inv_licences from anon, authenticated;

-- Visiteur : envoyer une commande (renvoie le numéro et le jeton pour envoyer les photos)
create or replace function public.commande_creer(p_commande json) returns json
language plpgsql security definer set search_path = public as $$
declare n text; j text;
begin
  if (select count(*) from inv_commandes where cree > now() - interval '10 minutes') > 40 then raise exception 'Trop de commandes en ce moment, réessayez dans quelques minutes'; end if;
  if length(p_commande::text) > 40000 then raise exception 'Commande trop longue'; end if;
  if coalesce(trim(p_commande->'client'->>'nom'), '') = '' or coalesce(trim(p_commande->'client'->>'telephone'), '') = '' then raise exception 'Nom et téléphone obligatoires'; end if;
  n := 'CMD-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  j := replace(gen_random_uuid()::text, '-', '');
  insert into inv_commandes(numero, jeton, modele, modele_titre, client, details)
  values (n, j, left(coalesce(p_commande->>'modele', ''), 200), left(coalesce(p_commande->>'modele_titre', ''), 200),
    coalesce((p_commande->'client')::jsonb, '{}'::jsonb), coalesce((p_commande->'details')::jsonb, '{}'::jsonb));
  return json_build_object('numero', n, 'jeton', j);
end $$;

-- Visiteur : joindre ses photos à sa commande (dans les 24 h, avec son jeton)
create or replace function public.commande_photos(p_numero text, p_jeton text, p_photos json) returns void
language plpgsql security definer set search_path = public as $$
begin
  if json_array_length(p_photos) > 30 then raise exception 'Trop de fichiers'; end if;
  update inv_commandes set photos = p_photos::jsonb, maj = now()
  where numero = p_numero and jeton = p_jeton and cree > now() - interval '1 day';
  if not found then raise exception 'Commande introuvable'; end if;
end $$;

-- Règle d'envoi des fichiers : le dossier doit être le jeton d'une commande récente
create or replace function public.inv_commande_dossier_ok(p_dossier text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from inv_commandes where jeton = p_dossier and cree > now() - interval '1 day');
$$;

-- Admin (clé admin de l'équipe) : lire et suivre les commandes
create or replace function public.commandes_lire(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  return coalesce((select json_agg(c order by c.cree desc) from (
    select numero, jeton, modele, modele_titre, client, details, photos, statut, notes, projet, licence, cree, maj from inv_commandes order by cree desc limit 500) c), '[]'::json);
end $$;

create or replace function public.commande_maj(p_cle text, p_numero text, p_champs json) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  update inv_commandes set
    statut = coalesce(left(p_champs->>'statut', 30), statut),
    notes = coalesce(left(p_champs->>'notes', 5000), notes),
    projet = coalesce(left(p_champs->>'projet', 64), projet),
    licence = coalesce(left(p_champs->>'licence', 40), licence),
    maj = now()
  where numero = p_numero;
end $$;

-- Admin : créer la licence d'une invitation livrée (un code par événement et par client)
create or replace function public.licence_creer(p_cle text, p_evt text, p_client text, p_commande text) returns text
language plpgsql security definer set search_path = public as $$
declare q record; c text;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  select code into c from inv_licences where evt = p_evt and statut = 'active' limit 1;
  if c is not null then return c; end if;
  c := 'LIC-' || upper(substr(md5(random()::text || p_evt), 1, 4)) || '-' || upper(substr(md5(clock_timestamp()::text || random()::text), 1, 4));
  insert into inv_licences(code, evt, client, commande) values (c, left(p_evt, 64), left(coalesce(p_client, ''), 200), left(coalesce(p_commande, ''), 40));
  if coalesce(p_commande, '') <> '' then update inv_commandes set licence = c, maj = now() where numero = p_commande; end if;
  return c;
end $$;

create or replace function public.licence_changer(p_cle text, p_code text, p_statut text) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  update inv_licences set statut = case when p_statut in ('active', 'suspendue', 'revoquee') then p_statut else statut end, change = now() where code = p_code;
end $$;

create or replace function public.licences_lire(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  return coalesce((select json_agg(l order by l.cree desc) from (select code, evt, client, commande, statut, cree, change from inv_licences order by cree desc limit 500) l), '[]'::json);
end $$;

-- Invitation : la licence de cet événement est-elle valable ?
create or replace function public.licence_verifier(p_evt text, p_code text) returns json
language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('ok', statut = 'active', 'statut', statut, 'client', client) from inv_licences where code = p_code and evt = p_evt),
    json_build_object('ok', false, 'statut', 'inconnue', 'client', ''));
$$;

grant execute on function public.commande_creer(json) to anon, authenticated;
grant execute on function public.commande_photos(text, text, json) to anon, authenticated;
grant execute on function public.inv_commande_dossier_ok(text) to anon, authenticated;
grant execute on function public.commandes_lire(text) to anon, authenticated;
grant execute on function public.commande_maj(text, text, json) to anon, authenticated;
grant execute on function public.licence_creer(text, text, text, text) to anon, authenticated;
grant execute on function public.licence_changer(text, text, text) to anon, authenticated;
grant execute on function public.licences_lire(text) to anon, authenticated;
grant execute on function public.licence_verifier(text, text) to anon, authenticated;

-- Fichiers des commandes (photos, chanson) : lecture par adresse, envoi seulement dans le dossier d'une commande récente
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('commandes', 'commandes', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/ogg'])
on conflict (id) do update set public = true, file_size_limit = 15728640, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "commandes envoi" on storage.objects;
create policy "commandes envoi" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'commandes' and public.inv_commande_dossier_ok((storage.foldername(name))[1]));
