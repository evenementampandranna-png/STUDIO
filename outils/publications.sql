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
