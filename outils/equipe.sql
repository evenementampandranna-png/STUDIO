-- Studio d'invitations : espace d'équipe (bibliothèque commune, travail de chacun, temps de fabrication)
-- À coller une fois dans Supabase → SQL Editor → Run (après supabase.sql).
-- Un seul lien pour l'équipe (clé d'équipe) ; un lien admin (clé admin) pour tout voir.

create table if not exists public.inv_equipes (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  nom text default '',
  cle text unique not null,
  cle_admin text unique not null,
  cree timestamptz default now()
);
create table if not exists public.inv_biblio (
  id text primary key,
  equipe text not null references public.inv_equipes(id) on delete cascade,
  auteur text default '',
  type text default 'fond',
  nom text default '',
  chemin text default '',
  vignette text default '',
  usage text default '',
  description text default '',
  duree real default 0,
  l int default 0,
  h int default 0,
  secondes_creation real,
  evenement text default '',
  cree timestamptz default now()
);
create index if not exists inv_biblio_equipe on public.inv_biblio(equipe, cree desc);
create table if not exists public.inv_travaux (
  equipe text not null references public.inv_equipes(id) on delete cascade,
  projet text not null,
  auteur text default '',
  titre text default '',
  slug text default '',
  plans int default 0,
  publie timestamptz,
  vignette text default '',
  maj timestamptz default now(),
  donnees jsonb,
  primary key (equipe, projet)
);
create table if not exists public.inv_creations (
  id bigserial primary key,
  equipe text not null references public.inv_equipes(id) on delete cascade,
  auteur text default '',
  projet text default '',
  titre_projet text default '',
  type text default '',
  nom text default '',
  secondes real default 0,
  date timestamptz default now()
);
create index if not exists inv_creations_equipe on public.inv_creations(equipe, date desc);

alter table public.inv_equipes enable row level security;
alter table public.inv_biblio enable row level security;
alter table public.inv_travaux enable row level security;
alter table public.inv_creations enable row level security;
revoke all on public.inv_equipes, public.inv_biblio, public.inv_travaux, public.inv_creations from anon, authenticated;

-- Trouve l'équipe d'une clé (clé d'équipe ou clé admin) ; admin = vrai si c'est la clé admin
create or replace function public.inv_equipe_de(p_cle text, out equipe text, out admin boolean)
language sql security definer set search_path = public as $$
  select id, (cle_admin = p_cle) from inv_equipes where p_cle is not null and length(p_cle) >= 20 and (cle = p_cle or cle_admin = p_cle) limit 1;
$$;
revoke all on function public.inv_equipe_de(text) from public, anon, authenticated;

-- Pour la règle d'envoi de fichiers : le dossier doit être une clé d'équipe valide
create or replace function public.inv_equipe_dossier_ok(p_dossier text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from inv_equipes where cle = p_dossier);
$$;
grant execute on function public.inv_equipe_dossier_ok(text) to anon, authenticated;

create or replace function public.equipe_creer(p_nom text) returns json
language plpgsql security definer set search_path = public as $$
declare e inv_equipes;
begin
  insert into inv_equipes(nom, cle, cle_admin) values (left(coalesce(p_nom, ''), 100),
    replace(gen_random_uuid()::text, '-', ''), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  returning * into e;
  return json_build_object('id', e.id, 'nom', e.nom, 'cle', e.cle, 'cle_admin', e.cle_admin);
end $$;

create or replace function public.equipe_info(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return (select json_build_object('id', id, 'nom', nom, 'admin', q.admin, 'cle', cle) from inv_equipes where id = q.equipe);
end $$;

create or replace function public.equipe_biblio_lire(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return coalesce((select json_agg(b order by b.cree desc) from (
    select id, auteur, type, nom, chemin, vignette, usage, description, duree, l, h, secondes_creation, evenement, cree from inv_biblio where equipe = q.equipe) b), '[]'::json);
end $$;

create or replace function public.equipe_biblio_ajouter(p_cle text, p_item json) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  if (select count(*) from inv_biblio where equipe = q.equipe) > 5000 then raise exception 'Bibliothèque pleine'; end if;
  insert into inv_biblio(id, equipe, auteur, type, nom, chemin, vignette, usage, description, duree, l, h, secondes_creation, evenement)
  values (left(p_item->>'id', 64), q.equipe, left(coalesce(p_item->>'auteur', ''), 80), left(coalesce(p_item->>'type', 'fond'), 20), left(coalesce(p_item->>'nom', ''), 200),
    left(coalesce(p_item->>'chemin', ''), 300), left(coalesce(p_item->>'vignette', ''), 200000), left(coalesce(p_item->>'usage', ''), 40), left(coalesce(p_item->>'description', ''), 1000),
    coalesce(nullif(p_item->>'duree', '')::real, 0), coalesce(nullif(p_item->>'l', '')::int, 0), coalesce(nullif(p_item->>'h', '')::int, 0),
    nullif(p_item->>'secondes_creation', '')::real, left(coalesce(p_item->>'evenement', ''), 200))
  on conflict (id) do update set nom = excluded.nom, usage = excluded.usage, description = excluded.description
  where inv_biblio.equipe = q.equipe;
end $$;

create or replace function public.equipe_biblio_supprimer(p_cle text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  delete from inv_biblio where equipe = q.equipe and id = p_id;
end $$;

create or replace function public.equipe_travail(p_cle text, p_travail json) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  if length(p_travail::text) > 3000000 then raise exception 'Projet trop lourd'; end if;
  insert into inv_travaux(equipe, projet, auteur, titre, slug, plans, publie, vignette, maj, donnees)
  values (q.equipe, left(p_travail->>'projet', 64), left(coalesce(p_travail->>'auteur', ''), 80), left(coalesce(p_travail->>'titre', ''), 200), left(coalesce(p_travail->>'slug', ''), 200),
    coalesce(nullif(p_travail->>'plans', '')::int, 0), nullif(p_travail->>'publie', '')::timestamptz, left(coalesce(p_travail->>'vignette', ''), 200000), now(), (p_travail->'donnees')::jsonb)
  on conflict (equipe, projet) do update set auteur = excluded.auteur, titre = excluded.titre, slug = excluded.slug, plans = excluded.plans, publie = excluded.publie,
    vignette = excluded.vignette, maj = now(), donnees = excluded.donnees;
end $$;

create or replace function public.equipe_creation(p_cle text, p_creation json) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  insert into inv_creations(equipe, auteur, projet, titre_projet, type, nom, secondes)
  values (q.equipe, left(coalesce(p_creation->>'auteur', ''), 80), left(coalesce(p_creation->>'projet', ''), 64), left(coalesce(p_creation->>'titre_projet', ''), 200),
    left(coalesce(p_creation->>'type', ''), 40), left(coalesce(p_creation->>'nom', ''), 200), coalesce(nullif(p_creation->>'secondes', '')::real, 0));
end $$;

-- Admin : tout le travail de l'équipe (sans le contenu des projets)
create or replace function public.equipe_admin(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  return json_build_object(
    'equipe', (select json_build_object('id', id, 'nom', nom, 'cle', cle) from inv_equipes where id = q.equipe),
    'travaux', coalesce((select json_agg(t order by t.maj desc) from (select projet, auteur, titre, slug, plans, publie, vignette, maj from inv_travaux where equipe = q.equipe) t), '[]'::json),
    'creations', coalesce((select json_agg(c order by c.date desc) from (select auteur, projet, titre_projet, type, nom, secondes, date from inv_creations where equipe = q.equipe order by date desc limit 2000) c), '[]'::json),
    'biblio', (select count(*) from inv_biblio where equipe = q.equipe));
end $$;

create or replace function public.equipe_projet(p_cle text, p_projet text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  return (select donnees::json from inv_travaux where equipe = q.equipe and projet = p_projet);
end $$;

grant execute on function public.equipe_creer(text) to anon, authenticated;
grant execute on function public.equipe_info(text) to anon, authenticated;
grant execute on function public.equipe_biblio_lire(text) to anon, authenticated;
grant execute on function public.equipe_biblio_ajouter(text, json) to anon, authenticated;
grant execute on function public.equipe_biblio_supprimer(text, text) to anon, authenticated;
grant execute on function public.equipe_travail(text, json) to anon, authenticated;
grant execute on function public.equipe_creation(text, json) to anon, authenticated;
grant execute on function public.equipe_admin(text) to anon, authenticated;
grant execute on function public.equipe_projet(text, text) to anon, authenticated;

-- Fichiers de la bibliothèque commune : dossier « equipe », lecture publique par adresse (pas de liste),
-- envoi seulement dans le dossier portant une clé d'équipe valide.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipe', 'equipe', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/ogg'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "equipe envoi" on storage.objects;
drop policy if exists "equipe lecture" on storage.objects;
drop policy if exists "equipe suppression" on storage.objects;
create policy "equipe envoi" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'equipe' and public.inv_equipe_dossier_ok((storage.foldername(name))[1]));
-- Pas de règle de lecture/liste ni de suppression : on lit les fichiers par leur adresse publique,
-- et personne ne peut lister le dossier (les clés d'équipe resteraient visibles).
