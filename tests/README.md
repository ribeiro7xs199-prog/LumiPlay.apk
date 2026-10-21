# Testes em navegador (opcionais)

Abrem o site de verdade em um Chromium sem janela (Playwright), com o TMDB, as imagens e o Supabase **simulados**, e conferem os fluxos principais: detalhes, player, botão Voltar, telas, busca, modo TV com controle remoto, painel administrativo, acessibilidade e layouts em vários tamanhos de tela. Usam a mesma Content Security Policy do arquivo `_headers`.

```
cd tests
npm install
npx playwright install chromium
npm test                 # todos os testes
node fluxo.test.js       # só um deles
```

Capturas de tela são gravadas em `tests/shots/`. Nada aqui precisa ser publicado.

Os testes não substituem abrir o site em aparelhos reais (TV, iPhone/Safari, Firefox) nem conferir o Supabase de verdade. Se mudar o `index.html`, os IDs ou os textos dos botões, ajuste os testes correspondentes.
