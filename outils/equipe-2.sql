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
