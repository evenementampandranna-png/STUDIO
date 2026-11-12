-- Studio d'invitations : les films de l'équipe partent sur le site (GitHub) et libèrent la place dans la base.
-- À coller une fois dans Supabase → SQL Editor → Run. Sans danger : ne supprime rien par lui-même.

-- un membre de l'équipe (qui connaît la clé du dossier) peut retirer un fichier de l'équipe
drop policy if exists "equipe suppression" on storage.objects;
create policy "equipe suppression" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'equipe' and public.inv_equipe_dossier_ok((storage.foldername(name))[1]));
drop policy if exists "equipe lecture" on storage.objects;
create policy "equipe lecture" on storage.objects for select to anon, authenticated
  using (bucket_id = 'equipe' and public.inv_equipe_dossier_ok((storage.foldername(name))[1]));

-- nouveau chemin d'un élément (ex. film déplacé sur le site : « site:medias/films/… »)
create or replace function public.equipe_biblio_deplacer(p_cle text, p_id text, p_chemin text) returns void
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from inv_equipe_de(p_cle);
  if q.equipe is null then raise exception 'Lien d''équipe invalide'; end if;
  update inv_biblio set chemin = left(coalesce(p_chemin, ''), 300) where equipe = q.equipe and id = p_id;
end $$;
grant execute on function public.equipe_biblio_deplacer(text, text, text) to anon, authenticated;
