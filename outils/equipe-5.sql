-- Studio d'invitations : chaque membre voit les invitations (événements) de toute l'équipe et peut en ouvrir une copie.
-- À coller une fois dans Supabase → SQL Editor → Run. Sans danger : ne supprime rien.

create or replace function public.equipe_projets_tous(p_cle text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return coalesce((select json_agg(t order by t.maj desc) from (
    select projet, auteur, titre, slug, plans, publie, vignette, maj from inv_travaux where equipe = q.equipe) t), '[]'::json);
end $$;

create or replace function public.equipe_projet_voir(p_cle text, p_projet text) returns json
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  return (select donnees::json from inv_travaux where equipe = q.equipe and projet = p_projet);
end $$;

grant execute on function public.equipe_projets_tous(text) to anon, authenticated;
grant execute on function public.equipe_projet_voir(text, text) to anon, authenticated;
