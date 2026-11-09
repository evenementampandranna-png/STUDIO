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
