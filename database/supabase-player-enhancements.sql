-- LumiPlay Etapa 8: suporte opcional a legendas WebVTT no catálogo.
-- Faça backup e execute no SQL Editor do projeto correto antes de depender da sincronização do campo.
alter table public.catalogo add column if not exists legendas_url text;

comment on column public.catalogo.legendas_url is 'URL HTTPS de legenda WebVTT (.vtt), opcional';

-- Limita a coluna a URLs WebVTT HTTPS ou NULL. A validação de domínio e CORS continua a cargo do administrador da fonte.
alter table public.catalogo drop constraint if exists catalogo_legendas_url_check;
alter table public.catalogo add constraint catalogo_legendas_url_check
  check (legendas_url is null or (legendas_url ~* '^https://[^[:space:]]+\.vtt([?#][^[:space:]]*)?$'));
