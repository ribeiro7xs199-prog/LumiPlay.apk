# Segurança do LumiPlay

Este pacote é um site estático: **não se conecta** ao seu Supabase, ao TMDB nem à hospedagem e não publica nada por você. Tudo abaixo precisa ser conferido no ambiente real.

## O que o pacote já faz

- Cabeçalhos em `_headers` (compatíveis com Netlify e Cloudflare): `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` e uma Content Security Policy. O `index.html` não usa scripts nem estilos inline além do que a CSP permite.
- O navegador usa apenas a chave pública (*publishable*) do Supabase, nunca a `service_role`. O script `scripts/verify-release.py` falha se encontrar uma chave secreta.
- Escrita no catálogo e nos canais de TV é limitada, por regras do banco (RLS), à conta administradora com o UID configurado. Os SQL em `database/` também criam guardas restritivas para impedir que políticas antigas liberem escrita a visitantes.
- Lista, progresso e histórico sincronizados ficam em `user_library_state`, com RLS por `auth.uid()`; o app não mistura dados locais de uma conta com os de outra.
- A comunidade pública permite ler e inserir, não editar nem apagar avaliações e eventos. Denúncias e moderação só são acessíveis à conta administradora.
- Todo texto vindo de catálogo, comentários e TMDB é escapado antes de ir para a página; endereços de capas, vídeos, legendas e canais só são aceitos em HTTPS.
- Novidade da 7.0: ao salvar canais de TV, o app grava primeiro e só depois remove os excluídos, confirmando antes a lista que já está no banco (veja `docs/CHANGELOG.md`).

## O que você precisa saber

- **A chave do TMDB está no JavaScript e qualquer visitante pode vê-la.** Use só uma chave de API pública, acompanhe o uso e aplique as restrições que o painel do TMDB permitir.
- **`visitor_id` é gerado no navegador** e pode ser falsificado: avaliações e contagens da comunidade são estimativas, não identidade verificada. Para um público grande, considere exigir conta para comentar.
- **A CSP usa `frame-src https:`** porque o site aceita players de provedores variados. Quando souber quais provedores usa, restrinja `frame-src` apenas a eles.
- **Não aplicamos `sandbox` nos iframes dos players** porque muitos provedores recusam tocar dentro de um iframe com `sandbox`. Se o seu provedor permitir, acrescentar `sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-fullscreen"` impede pop-ups e redirecionamentos da página; teste antes.
- **Os arquivos de `database/`, `docs/`, `scripts/` e `tests/` não precisam ser publicados.** Eles não contêm segredos, mas não há motivo para deixá-los públicos.
- O LumiPlay mostra o que você cadastrar: use somente vídeos próprios, de domínio público ou licenciados.

## Checklist depois de publicar

1. Backup do Supabase; execute os SQL na ordem do `README.md` no projeto correto.
2. Em **Authentication → Policies**, confirme RLS ativo em `catalogo`, `tv_channels`, `catalogo_feedback`, `catalogo_eventos`, `catalogo_denuncias_feedback`, `lumiplay_admin_audit` e `user_library_state`.
3. Abra o site em janela anônima: o catálogo deve carregar e nenhuma edição deve ser possível.
4. Entre como administrador: adicionar, editar e excluir **um** título; adicionar um canal de TV.
5. Entre com outra conta comum: ela não pode alterar o catálogo.
6. Teste login, logout e sincronização de lista/progresso em dois aparelhos.
7. Inspecione os cabeçalhos da resposta (aba Rede do navegador) e confira `Content-Security-Policy`. Se algo for bloqueado, libere só a origem necessária e confiável; não remova a política inteira.
8. Teste player, TMDB, trailer e canais de TV depois de aplicar a CSP.
