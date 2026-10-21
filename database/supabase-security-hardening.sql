-- LumiPlay Etapa 4: endurecimento idempotente das tabelas de comunidade.
-- Execute no SQL Editor do projeto correto depois de fazer backup.
-- A comunidade continua pública para leitura e criação, mas não permite editar
-- ou apagar avaliações/eventos existentes por meio da chave pública.

alter table public.catalogo_feedback enable row level security;
alter table public.catalogo_eventos enable row level security;

drop policy if exists "feedback public update" on public.catalogo_feedback;
revoke update, delete on table public.catalogo_feedback from anon, authenticated;
grant select, insert on table public.catalogo_feedback to anon, authenticated;

revoke update, delete on table public.catalogo_eventos from anon, authenticated;
grant select, insert on table public.catalogo_eventos to anon, authenticated;

-- Recria as políticas de inserção com limites de tamanho e valores esperados.
drop policy if exists "feedback public insert" on public.catalogo_feedback;
create policy "feedback public insert"
  on public.catalogo_feedback for insert to anon, authenticated
  with check (
    length(visitor_id) between 1 and 100
    and length(app_id) between 1 and 200
    and (avaliacao is null or avaliacao between 1 and 5)
    and length(comentario) <= 800
  );

drop policy if exists "feedback public read" on public.catalogo_feedback;
create policy "feedback public read"
  on public.catalogo_feedback for select to anon, authenticated
  using (true);

drop policy if exists "events public insert" on public.catalogo_eventos;
create policy "events public insert"
  on public.catalogo_eventos for insert to anon, authenticated
  with check (
    length(visitor_id) between 1 and 100
    and length(app_id) between 1 and 200
    and tipo_evento in ('click','completed')
  );

drop policy if exists "events public read" on public.catalogo_eventos;
create policy "events public read"
  on public.catalogo_eventos for select to anon, authenticated
  using (true);
