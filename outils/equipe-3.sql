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
