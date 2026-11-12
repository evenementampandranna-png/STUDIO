-- Studio d'invitations : SCRIPT COMPLET pour une nouvelle base Supabase (tout en une fois).
-- Supabase → SQL Editor → New query → coller → Run. Sans danger si on le relance.

-- ========== supabase.sql ==========
-- Studio d'invitations : base des invités et des réponses (Supabase)
-- À coller une seule fois dans Supabase → SQL Editor → Run.
-- Les tables sont fermées (RLS sans règle) : on n'y accède QUE par les fonctions ci-dessous.
-- L'organisateur est reconnu par une clé secrète (dans son lien) ; les invités par le code de leur famille.

create table if not exists public.inv_evenements (
  id text primary key,
  cle text not null,
  titre text default '',
  slug text default '',
  langue text default 'fr',
  cree timestamptz default now(),
  maj timestamptz default now()
);
create table if not exists public.inv_familles (
  evt text not null references public.inv_evenements(id) on delete cascade,
  code text not null,
  nom text not null default '',
  categorie text default '',
  places int default 1,
  telephone text default '',
  table_nom text default '',
  statut text default 'attente',
  adultes int default 0,
  enfants int default 0,
  message text default '',
  repondu timestamptz,
  ordre int default 0,
  primary key (evt, code)
);
create table if not exists public.inv_reponses (
  id bigserial primary key,
  evt text not null references public.inv_evenements(id) on delete cascade,
  code text,
  nom text,
  presence text,
  adultes int default 0,
  enfants int default 0,
  message text,
  date timestamptz default now()
);
create index if not exists inv_reponses_evt on public.inv_reponses(evt, date desc);

alter table public.inv_evenements enable row level security;
alter table public.inv_familles enable row level security;
alter table public.inv_reponses enable row level security;
revoke all on public.inv_evenements, public.inv_familles, public.inv_reponses from anon, authenticated;

-- Vérifie la clé de l'organisateur
create or replace function public.inv_verifier(p_evt text, p_cle text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_cle is null or length(p_cle) < 16 or not exists (select 1 from inv_evenements where id = p_evt and cle = p_cle) then
    raise exception 'Lien organisateur invalide';
  end if;
end $$;
revoke all on function public.inv_verifier(text, text) from public, anon, authenticated;

-- Studio : crée l'événement (la première clé reçue devient celle de l'organisateur) ou met à jour son titre
create or replace function public.inv_studio_publier(p_evt text, p_cle text, p_titre text, p_slug text, p_langue text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into inv_evenements(id, cle, titre, slug, langue) values (p_evt, p_cle, coalesce(p_titre, ''), coalesce(p_slug, ''), coalesce(p_langue, 'fr'))
  on conflict (id) do nothing;
  perform inv_verifier(p_evt, p_cle);
  update inv_evenements set titre = coalesce(p_titre, titre), slug = coalesce(p_slug, slug), langue = coalesce(p_langue, langue), maj = now() where id = p_evt;
end $$;

-- Organisateur : tout lire (familles + réponses)
create or replace function public.inv_hote_lire(p_evt text, p_cle text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform inv_verifier(p_evt, p_cle);
  return json_build_object(
    'evenement', (select json_build_object('id', id, 'titre', titre, 'slug', slug, 'langue', langue) from inv_evenements where id = p_evt),
    'familles', coalesce((select json_agg(f order by f.ordre, f.nom) from (
        select code, nom, categorie, places, telephone, table_nom as "table", statut, adultes, enfants, message, repondu, ordre
        from inv_familles where evt = p_evt) f), '[]'::json),
    'reponses', coalesce((select json_agg(r order by r.date desc) from (
        select id, code, nom, presence, adultes, enfants, message, date from inv_reponses where evt = p_evt order by date desc limit 1000) r), '[]'::json));
end $$;

-- Organisateur / studio : ajouter ou modifier des familles (sans en supprimer)
create or replace function public.inv_hote_familles(p_evt text, p_cle text, p_familles json) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform inv_verifier(p_evt, p_cle);
  if json_array_length(p_familles) > 3000 then raise exception 'Trop de familles'; end if;
  insert into inv_familles(evt, code, nom, categorie, places, telephone, table_nom, statut, adultes, enfants, ordre)
  select p_evt, left(x->>'code', 32), left(coalesce(x->>'nom', ''), 200), left(coalesce(x->>'categorie', ''), 100),
         greatest(0, least(coalesce(nullif(x->>'places', '')::int, 1), 500)), left(coalesce(x->>'telephone', ''), 40), left(coalesce(x->>'table', ''), 60),
         case when x->>'statut' in ('attente', 'vient', 'non') then x->>'statut' else 'attente' end,
         greatest(0, least(coalesce(nullif(x->>'adultes', '')::int, 0), 500)), greatest(0, least(coalesce(nullif(x->>'enfants', '')::int, 0), 500)),
         coalesce(nullif(x->>'ordre', '')::int, o::int)
  from json_array_elements(p_familles) with ordinality as t(x, o)
  where coalesce(x->>'code', '') <> ''
  on conflict (evt, code) do update set nom = excluded.nom, categorie = excluded.categorie, places = excluded.places, telephone = excluded.telephone,
    table_nom = excluded.table_nom, statut = excluded.statut, adultes = excluded.adultes, enfants = excluded.enfants, ordre = excluded.ordre;
end $$;

-- Organisateur / studio : supprimer une famille
create or replace function public.inv_hote_supprimer(p_evt text, p_cle text, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform inv_verifier(p_evt, p_cle);
  delete from inv_familles where evt = p_evt and code = p_code;
end $$;

-- Invité : lire sa famille (avec le code de son lien)
create or replace function public.inv_famille(p_evt text, p_code text) returns json
language sql security definer set search_path = public as $$
  select json_build_object('code', code, 'nom', nom, 'places', places, 'adultes', adultes, 'enfants', enfants, 'statut', statut, 'table', table_nom)
  from inv_familles where evt = p_evt and code = p_code;
$$;

-- Invité : envoyer sa réponse
create or replace function public.inv_repondre(p_evt text, p_code text, p_nom text, p_presence text, p_adultes int, p_enfants int, p_message text) returns json
language plpgsql security definer set search_path = public as $$
declare f inv_familles; a int; e int;
begin
  if not exists (select 1 from inv_evenements where id = p_evt) then raise exception 'Événement inconnu'; end if;
  if (select count(*) from inv_reponses where evt = p_evt and date > now() - interval '1 minute') > 60 then raise exception 'Trop de réponses, réessayez dans une minute'; end if;
  a := greatest(0, least(coalesce(p_adultes, 0), 50)); e := greatest(0, least(coalesce(p_enfants, 0), 50));
  if p_presence <> 'oui' then a := 0; e := 0; end if;
  select * into f from inv_familles where evt = p_evt and code = p_code;
  if found then
    if p_presence = 'oui' and f.places > 0 and a + e > f.places then raise exception 'Plus de personnes que de places prévues (%)', f.places; end if;
    update inv_familles set statut = case when p_presence = 'oui' then 'vient' else 'non' end, adultes = a, enfants = e,
      message = left(coalesce(p_message, ''), 500), repondu = now() where evt = p_evt and code = p_code;
  end if;
  insert into inv_reponses(evt, code, nom, presence, adultes, enfants, message)
  values (p_evt, case when found then p_code else null end, left(coalesce(case when found then f.nom else p_nom end, ''), 200), case when p_presence = 'oui' then 'oui' else 'non' end, a, e, left(coalesce(p_message, ''), 500));
  return json_build_object('ok', true);
end $$;

grant execute on function public.inv_studio_publier(text, text, text, text, text) to anon, authenticated;
grant execute on function public.inv_hote_lire(text, text) to anon, authenticated;
grant execute on function public.inv_hote_familles(text, text, json) to anon, authenticated;
grant execute on function public.inv_hote_supprimer(text, text, text) to anon, authenticated;
grant execute on function public.inv_famille(text, text) to anon, authenticated;
grant execute on function public.inv_repondre(text, text, text, text, int, int, text) to anon, authenticated;

-- ========== invites-2.sql ==========
-- Studio d'invitations : nombre d'adultes et d'enfants invités par famille (en plus du total de places)
-- À coller une fois dans Supabase → SQL Editor → Run (après supabase.sql). Sans danger : ne supprime rien.

alter table public.inv_familles add column if not exists prevus_adultes int;
alter table public.inv_familles add column if not exists prevus_enfants int;

-- Organisateur : tout lire (familles + réponses), avec les adultes / enfants invités
create or replace function public.inv_hote_lire(p_evt text, p_cle text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform inv_verifier(p_evt, p_cle);
  return json_build_object(
    'evenement', (select json_build_object('id', id, 'titre', titre, 'slug', slug, 'langue', langue) from inv_evenements where id = p_evt),
    'familles', coalesce((select json_agg(f order by f.ordre, f.nom) from (
        select code, nom, categorie, places, prevus_adultes, prevus_enfants, telephone, table_nom as "table", statut, adultes, enfants, message, repondu, ordre
        from inv_familles where evt = p_evt) f), '[]'::json),
    'reponses', coalesce((select json_agg(r order by r.date desc) from (
        select id, code, nom, presence, adultes, enfants, message, date from inv_reponses where evt = p_evt order by date desc limit 1000) r), '[]'::json));
end $$;

-- Organisateur / studio : ajouter ou modifier des familles
create or replace function public.inv_hote_familles(p_evt text, p_cle text, p_familles json) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform inv_verifier(p_evt, p_cle);
  if json_array_length(p_familles) > 3000 then raise exception 'Trop de familles'; end if;
  insert into inv_familles(evt, code, nom, categorie, places, prevus_adultes, prevus_enfants, telephone, table_nom, statut, adultes, enfants, ordre)
  select p_evt, left(x->>'code', 32), left(coalesce(x->>'nom', ''), 200), left(coalesce(x->>'categorie', ''), 100),
         greatest(0, least(coalesce(nullif(x->>'places', '')::int, 1), 500)),
         case when nullif(x->>'prevus_adultes', '') is null then null else greatest(0, least((x->>'prevus_adultes')::int, 500)) end,
         case when nullif(x->>'prevus_enfants', '') is null then null else greatest(0, least((x->>'prevus_enfants')::int, 500)) end,
         left(coalesce(x->>'telephone', ''), 40), left(coalesce(x->>'table', ''), 60),
         case when x->>'statut' in ('attente', 'vient', 'non') then x->>'statut' else 'attente' end,
         greatest(0, least(coalesce(nullif(x->>'adultes', '')::int, 0), 500)), greatest(0, least(coalesce(nullif(x->>'enfants', '')::int, 0), 500)),
         coalesce(nullif(x->>'ordre', '')::int, o::int)
  from json_array_elements(p_familles) with ordinality as t(x, o)
  where coalesce(x->>'code', '') <> ''
  on conflict (evt, code) do update set nom = excluded.nom, categorie = excluded.categorie, places = excluded.places,
    prevus_adultes = excluded.prevus_adultes, prevus_enfants = excluded.prevus_enfants, telephone = excluded.telephone,
    table_nom = excluded.table_nom, statut = excluded.statut, adultes = excluded.adultes, enfants = excluded.enfants, ordre = excluded.ordre;
end $$;

-- Invité : lire sa famille (avec le code de son lien)
create or replace function public.inv_famille(p_evt text, p_code text) returns json
language sql security definer set search_path = public as $$
  select json_build_object('code', code, 'nom', nom, 'places', places, 'prevus_adultes', prevus_adultes, 'prevus_enfants', prevus_enfants,
    'adultes', adultes, 'enfants', enfants, 'statut', statut, 'table', table_nom)
  from inv_familles where evt = p_evt and code = p_code;
$$;

-- Invité : envoyer sa réponse (ne peut pas dépasser les adultes / enfants invités)
create or replace function public.inv_repondre(p_evt text, p_code text, p_nom text, p_presence text, p_adultes int, p_enfants int, p_message text) returns json
language plpgsql security definer set search_path = public as $$
declare f inv_familles; a int; e int;
begin
  if not exists (select 1 from inv_evenements where id = p_evt) then raise exception 'Événement inconnu'; end if;
  if (select count(*) from inv_reponses where evt = p_evt and date > now() - interval '1 minute') > 60 then raise exception 'Trop de réponses, réessayez dans une minute'; end if;
  a := greatest(0, least(coalesce(p_adultes, 0), 50)); e := greatest(0, least(coalesce(p_enfants, 0), 50));
  if p_presence <> 'oui' then a := 0; e := 0; end if;
  select * into f from inv_familles where evt = p_evt and code = p_code;
  if found then
    if p_presence = 'oui' and f.prevus_adultes is not null and a > f.prevus_adultes then raise exception 'Plus d''adultes que de places prévues (%)', f.prevus_adultes; end if;
    if p_presence = 'oui' and f.prevus_enfants is not null and e > f.prevus_enfants then raise exception 'Plus d''enfants que de places prévues (%)', f.prevus_enfants; end if;
    if p_presence = 'oui' and f.places > 0 and a + e > f.places then raise exception 'Plus de personnes que de places prévues (%)', f.places; end if;
    update inv_familles set statut = case when p_presence = 'oui' then 'vient' else 'non' end, adultes = a, enfants = e,
      message = left(coalesce(p_message, ''), 500), repondu = now() where evt = p_evt and code = p_code;
  end if;
  insert into inv_reponses(evt, code, nom, presence, adultes, enfants, message)
  values (p_evt, case when found then p_code else null end, left(coalesce(case when found then f.nom else p_nom end, ''), 200), case when p_presence = 'oui' then 'oui' else 'non' end, a, e, left(coalesce(p_message, ''), 500));
  return json_build_object('ok', true);
end $$;

grant execute on function public.inv_hote_lire(text, text) to anon, authenticated;
grant execute on function public.inv_hote_familles(text, text, json) to anon, authenticated;
grant execute on function public.inv_famille(text, text) to anon, authenticated;
grant execute on function public.inv_repondre(text, text, text, text, int, int, text) to anon, authenticated;

-- ========== equipe.sql ==========
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

-- ========== equipe-2.sql ==========
-- Studio d'invitations : mise à jour 2 (à coller une fois dans Supabase → SQL Editor → Run)
-- 1. Tous les membres voient les modèles (invitations) de l'équipe et peuvent en partir.
-- 2. Les invités du lien général retrouvent leur nom dans la liste (pour que leur réponse aille à leur famille).

create or replace function public.equipe_modeles(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return coalesce((select json_agg(t order by t.maj desc) from (
    select projet, auteur, titre, slug, plans, publie, vignette, maj from inv_travaux where equipe = q.equipe) t), '[]'::json);
end $$;

create or replace function public.equipe_modele(p_cle text, p_projet text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  -- copie de travail : sans les familles ni le lien organisateur (données privées du client)
  return (select (donnees - 'familles' - 'cle_hote' - 'reponses_generales')::json from inv_travaux where equipe = q.equipe and projet = p_projet);
end $$;

-- Recherche d'un nom dans la liste des invités (au moins 3 lettres, 6 résultats au plus, nom seulement)
create or replace function public.inv_chercher_famille(p_evt text, p_texte text) returns json
language plpgsql security definer set search_path = public as $$
declare t text := lower(trim(coalesce(p_texte, '')));
begin
  if length(t) < 3 then return '[]'::json; end if;
  return coalesce((select json_agg(x) from (
    select code, nom from inv_familles where evt = p_evt and lower(nom) like '%' || replace(replace(t, '%', ''), '_', '') || '%' order by nom limit 6) x), '[]'::json);
end $$;

grant execute on function public.equipe_modeles(text) to anon, authenticated;
grant execute on function public.equipe_modele(text, text) to anon, authenticated;
grant execute on function public.inv_chercher_famille(text, text) to anon, authenticated;

-- ========== sauvegarde.sql ==========
-- Studio d'invitations : chaque membre récupère ses invitations depuis la copie en ligne de l'équipe
-- (après une panne d'ordinateur, un navigateur effacé ou sur un autre PC).
-- À coller une fois dans Supabase → SQL Editor → Run (après equipe.sql). Sans danger : ne supprime rien.

create or replace function public.equipe_mes_projets(p_cle text, p_auteur text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return coalesce((select json_agg(t order by t.maj desc) from (
    select projet, auteur, titre, slug, plans, maj from inv_travaux
    where equipe = q.equipe and (q.admin or lower(trim(auteur)) = lower(trim(coalesce(p_auteur, ''))))) t), '[]'::json);
end $$;

create or replace function public.equipe_mon_projet(p_cle text, p_projet text, p_auteur text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return (select donnees::json from inv_travaux where equipe = q.equipe and projet = p_projet
    and (q.admin or lower(trim(auteur)) = lower(trim(coalesce(p_auteur, '')))));
end $$;

grant execute on function public.equipe_mes_projets(text, text) to anon, authenticated;
grant execute on function public.equipe_mon_projet(text, text, text) to anon, authenticated;

-- Copie en ligne des « accessoires » de chaque membre : bibliothèque, mes polices, préférences du studio
-- (les fichiers eux-mêmes sont dans le stockage « equipe » ; ici seulement la liste et les réglages)
create table if not exists public.inv_accessoires (
  equipe text not null references public.inv_equipes(id) on delete cascade,
  membre text not null default '',
  donnees jsonb not null default '{}'::jsonb,
  maj timestamptz default now(),
  primary key (equipe, membre)
);
alter table public.inv_accessoires enable row level security;
revoke all on public.inv_accessoires from anon, authenticated;

create or replace function public.equipe_accessoires_sauver(p_cle text, p_membre text, p_donnees json) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  if length(p_donnees::text) > 5000000 then raise exception 'Copie trop grosse'; end if;
  insert into inv_accessoires(equipe, membre, donnees, maj) values (q.equipe, lower(trim(coalesce(p_membre, ''))), p_donnees::jsonb, now())
  on conflict (equipe, membre) do update set donnees = excluded.donnees, maj = now();
end $$;

create or replace function public.equipe_accessoires_lire(p_cle text, p_membre text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return (select donnees::json from inv_accessoires where equipe = q.equipe and membre = lower(trim(coalesce(p_membre, '')))) ;
end $$;

grant execute on function public.equipe_accessoires_sauver(text, text, json) to anon, authenticated;
grant execute on function public.equipe_accessoires_lire(text, text) to anon, authenticated;

-- ========== publications.sql ==========
-- Studio d'invitations : les membres demandent la publication, l'admin valide (et publie depuis son studio)
-- À coller une fois dans Supabase → SQL Editor → Run (après equipe.sql). Sans danger : ne supprime rien.

create table if not exists public.inv_pub_demandes (
  id bigserial primary key,
  equipe text not null references public.inv_equipes(id) on delete cascade,
  membre text not null default '',
  type text not null default 'invitation',      -- invitation | film
  objet text not null default '',               -- id du projet ou de la vidéo
  titre text default '',
  statut text not null default 'attente',       -- attente | publiee | refusee
  message text default '',
  resultat jsonb not null default '{}'::jsonb,
  cree timestamptz default now(),
  maj timestamptz default now()
);
create index if not exists inv_pub_demandes_equipe on public.inv_pub_demandes(equipe, cree desc);
alter table public.inv_pub_demandes enable row level security;
revoke all on public.inv_pub_demandes from anon, authenticated;

-- Membre : demander (ou redemander) la publication
create or replace function public.equipe_pub_demander(p_cle text, p_membre text, p_type text, p_objet text, p_titre text) returns json
language plpgsql security definer set search_path = public as $$
declare q record; d inv_pub_demandes;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  select * into d from inv_pub_demandes where equipe = q.equipe and type = p_type and objet = p_objet and statut = 'attente' limit 1;
  if found then
    update inv_pub_demandes set titre = left(coalesce(p_titre, ''), 200), maj = now() where id = d.id;
    return json_build_object('id', d.id);
  end if;
  insert into inv_pub_demandes(equipe, membre, type, objet, titre)
  values (q.equipe, left(coalesce(p_membre, ''), 80), case when p_type = 'film' then 'film' else 'invitation' end, left(coalesce(p_objet, ''), 80), left(coalesce(p_titre, ''), 200))
  returning * into d;
  return json_build_object('id', d.id);
end $$;

-- Liste : l'admin voit tout ; un membre voit ses demandes
create or replace function public.equipe_pub_liste(p_cle text, p_membre text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return coalesce((select json_agg(x order by x.cree desc) from (
    select id, membre, type, objet, titre, statut, message, resultat, cree, maj from inv_pub_demandes
    where equipe = q.equipe and (q.admin or lower(trim(membre)) = lower(trim(coalesce(p_membre, ''))))
    order by cree desc limit 300) x), '[]'::json);
end $$;

-- Admin : valider (publiée) ou refuser
create or replace function public.equipe_pub_maj(p_cle text, p_id bigint, p_statut text, p_message text, p_resultat json) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null or not q.admin then raise exception 'Lien admin invalide'; end if;
  update inv_pub_demandes set statut = case when p_statut in ('attente', 'publiee', 'refusee') then p_statut else statut end,
    message = left(coalesce(p_message, message), 500), resultat = coalesce(p_resultat::jsonb, resultat), maj = now()
  where id = p_id and equipe = q.equipe;
end $$;

grant execute on function public.equipe_pub_demander(text, text, text, text, text) to anon, authenticated;
grant execute on function public.equipe_pub_liste(text, text) to anon, authenticated;
grant execute on function public.equipe_pub_maj(text, bigint, text, text, json) to anon, authenticated;

-- ========== commandes.sql ==========
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

-- ========== invites-3.sql ==========
-- Studio d'invitations : « côté » de chaque famille et date d'envoi de son invitation (espace organisateur).
-- À coller une fois dans Supabase → SQL Editor → Run. Sans danger : ne supprime rien.

alter table public.inv_familles add column if not exists cote text;
alter table public.inv_familles add column if not exists envoye timestamptz;

create or replace function public.inv_hote_lire(p_evt text, p_cle text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform inv_verifier(p_evt, p_cle);
  return json_build_object(
    'evenement', (select json_build_object('id', id, 'titre', titre, 'slug', slug, 'langue', langue) from inv_evenements where id = p_evt),
    'familles', coalesce((select json_agg(f order by f.ordre, f.nom) from (
        select code, nom, categorie, places, prevus_adultes, prevus_enfants, telephone, table_nom as "table", statut, adultes, enfants, message, repondu, ordre,
               coalesce(cote, '') as cote, envoye
        from inv_familles where evt = p_evt) f), '[]'::json),
    'reponses', coalesce((select json_agg(r order by r.date desc) from (
        select id, code, nom, presence, adultes, enfants, message, date from inv_reponses where evt = p_evt order by date desc limit 1000) r), '[]'::json));
end $$;

-- ajouter / modifier des familles : « côté » et « envoyée » ne sont changés que s'ils sont fournis
create or replace function public.inv_hote_familles(p_evt text, p_cle text, p_familles json) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform inv_verifier(p_evt, p_cle);
  if json_array_length(p_familles) > 3000 then raise exception 'Trop de familles'; end if;
  insert into inv_familles(evt, code, nom, categorie, places, prevus_adultes, prevus_enfants, telephone, table_nom, statut, adultes, enfants, ordre, cote, envoye)
  select p_evt, left(x->>'code', 32), left(coalesce(x->>'nom', ''), 200), left(coalesce(x->>'categorie', ''), 100),
         greatest(0, least(coalesce(nullif(x->>'places', '')::int, 1), 500)),
         case when nullif(x->>'prevus_adultes', '') is null then null else greatest(0, least((x->>'prevus_adultes')::int, 500)) end,
         case when nullif(x->>'prevus_enfants', '') is null then null else greatest(0, least((x->>'prevus_enfants')::int, 500)) end,
         left(coalesce(x->>'telephone', ''), 40), left(coalesce(x->>'table', ''), 60),
         case when x->>'statut' in ('attente', 'vient', 'non') then x->>'statut' else 'attente' end,
         greatest(0, least(coalesce(nullif(x->>'adultes', '')::int, 0), 500)), greatest(0, least(coalesce(nullif(x->>'enfants', '')::int, 0), 500)),
         coalesce(nullif(x->>'ordre', '')::int, o::int),
         case when x::jsonb ? 'cote' then left(coalesce(x->>'cote', ''), 60) else null end,
         case when nullif(x->>'envoye', '') is null then null else (x->>'envoye')::timestamptz end
  from json_array_elements(p_familles) with ordinality as t(x, o)
  where coalesce(x->>'code', '') <> ''
  on conflict (evt, code) do update set nom = excluded.nom, categorie = excluded.categorie, places = excluded.places,
    prevus_adultes = excluded.prevus_adultes, prevus_enfants = excluded.prevus_enfants, telephone = excluded.telephone,
    table_nom = excluded.table_nom, statut = excluded.statut, adultes = excluded.adultes, enfants = excluded.enfants, ordre = excluded.ordre,
    cote = coalesce(excluded.cote, inv_familles.cote), envoye = coalesce(excluded.envoye, inv_familles.envoye);
end $$;

grant execute on function public.inv_hote_lire(text, text) to anon, authenticated;
grant execute on function public.inv_hote_familles(text, text, json) to anon, authenticated;

-- ========== equipe-3.sql ==========
-- Studio d'invitations : chargement léger de la bibliothèque d'équipe (seulement ce qui a changé).
-- Évite de retélécharger toutes les vignettes à chaque ouverture (économise le quota de la base).
-- À coller une fois dans Supabase → SQL Editor → Run. Sans danger : ne supprime rien.

create or replace function public.equipe_biblio_ids(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return coalesce((select json_agg(id order by cree desc) from inv_biblio where equipe = q.equipe), '[]'::json);
end $$;

create or replace function public.equipe_biblio_lire_ids(p_cle text, p_ids json) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  if json_array_length(p_ids) > 200 then raise exception 'Trop d''éléments demandés'; end if;
  return coalesce((select json_agg(b order by b.cree desc) from (
    select id, auteur, type, nom, chemin, vignette, usage, description, duree, l, h, secondes_creation, evenement, cree from inv_biblio
    where equipe = q.equipe and id in (select json_array_elements_text(p_ids))) b), '[]'::json);
end $$;

grant execute on function public.equipe_biblio_ids(text) to anon, authenticated;
grant execute on function public.equipe_biblio_lire_ids(text, json) to anon, authenticated;

-- ========== migration : reprendre la même équipe (mêmes liens) dans la nouvelle base ==========
-- Possible seulement si cette équipe n'existe pas encore ici (une fois, par l'admin, depuis le studio).
create or replace function public.equipe_importer(p_id text, p_nom text, p_cle text, p_cle_admin text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_cle, '') = '' or coalesce(p_cle_admin, '') = '' or length(p_cle) < 20 or length(p_cle_admin) < 20 then raise exception 'Clés invalides'; end if;
  if exists (select 1 from inv_equipes where cle_admin = p_cle_admin) then return json_build_object('ok', true, 'deja', true); end if;
  if exists (select 1 from inv_equipes where cle = p_cle or cle_admin = p_cle or cle = p_cle_admin) then raise exception 'Équipe déjà présente avec d''autres clés'; end if;
  if (select count(*) from inv_equipes) >= 5 then raise exception 'Trop d''équipes'; end if;
  insert into inv_equipes(id, nom, cle, cle_admin) values (coalesce(nullif(p_id, ''), replace(gen_random_uuid()::text, '-', '')), left(coalesce(p_nom, ''), 100), p_cle, p_cle_admin);
  return json_build_object('ok', true);
end $$;
grant execute on function public.equipe_importer(text, text, text, text) to anon, authenticated;
