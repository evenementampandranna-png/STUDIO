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
