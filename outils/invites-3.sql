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
