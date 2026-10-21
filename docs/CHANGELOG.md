# Histórico de mudanças

## 7.0.0 — redesenho completo

### Visual e experiência
- CSS reescrito do zero (um sistema de design com variáveis), no lugar de dezenas de camadas de ajustes acumuladas, muitas com `!important`.
- Tema “sala escura” com as cores do logotipo (azul, violeta e magenta) usadas só onde há atenção: foco, progresso e ação principal.
- Destaque com imagem larga, metadados em pílulas, trilho de miniaturas, barra de tempo, pausa ao apontar/focar e gesto de deslizar no celular. Sem imagem larga, usa a capa e busca a imagem larga no TMDB.
- Fileiras horizontais: Continue assistindo (com barra de progresso), Em alta, Escolhidos para você e uma por gênero (“Ver todos” abre o gênero).
- Cartões: botão de coração direto na capa, aro de luz ao focar, metadados sem texto emendado por símbolos, esqueletos de carregamento.
- Detalhes em tela cheia: elenco, títulos relacionados, trailer, comunidade e compartilhamento com link direto. Em tela estreita a ordem segue o projeto anterior (sinopse, episódios, avaliação, elenco, recomendações).
- Player: layout centralizado, botão **Próximo episódio**, **Tela cheia**, aviso de carregamento.
- Navegação: barra inferior no celular, menu do perfil (perfis, conta, administração, TMDB, sobre), busca com sugestões e capas, atalho `/`.
- Ícones em SVG no lugar de caracteres Unicode (que variam entre aparelhos e somem em algumas TVs).
- Estados vazios, 404 personalizada, textos revisados (sem “(s)” e sem símbolos de separação).

### Celular, tablet, computador e TV
- Layouts próprios para celular, tablet (retrato e paisagem), notebook, desktop e TV; sem rolagem horizontal.
- **Modo TV**: detecção automática, `?tv=1`/`?tv=0`, navegação espacial pelas setas, foco bem visível, margem de segurança de 5%, tecla Voltar do controle (Tizen 10009, webOS 461).
- Botão Voltar do navegador/celular fecha a janela aberta; rotas `#/filmes`, `#/series`, `#/tv`, `#/lista`, `#/assistidos` e `#/titulo/ID`.
- Instalável como app (manifesto, ícones comuns e “maskable”, ícone iOS), cor de tema.
- Respeita “reduzir movimento”, áreas seguras (entalhe) e teclado: foco preso nas janelas, retorno de foco, link “Pular para o conteúdo”, janelas anunciadas a leitores de tela.

### Desempenho
- Imagens responsivas do TMDB (`srcset` 185/342/500 px; destaque em 780/1280 px), logotipo em WebP, conexões antecipadas ao TMDB.
- “Mostrar mais” só acrescenta cartões novos (não redesenha a grade) e carrega o próximo lote ao rolar.
- Gravação do catálogo no navegador agrupada (antes reescrevia tudo a cada resposta da API) e redesenho das fileiras agrupado.
- Detecção de aparelho modesto corrigida: antes, qualquer aparelho com até 4 núcleos ou 4 GB perdia recomendações, destaque e avaliações; agora só TVs e aparelhos de até 2 núcleos/2 GB.
- Cabeçalhos de cache em `_headers`; o catálogo de contingência só entra se TMDB e banco não responderem.

### Bugs corrigidos
1. O modal **Perfis** nunca abria (o nome estava ausente do mapa de janelas).
2. **Continue assistindo** não aparecia ao carregar a página.
3. “Mais populares” aparecia por cima de TV, histórico e lista; o item ativo do menu ficava marcado em dois lugares.
4. Aparelhos comuns (≤ 4 núcleos/4 GB) eram tratados como TV (veja Desempenho).
5. Fechar a TV ao vivo com **Esc** não parava a transmissão.
6. **Salvar canais de TV** apagava todos os canais do banco antes de gravar: uma falha no meio perdia tudo. Agora grava primeiro, só então remove os excluídos, e confirma a lista da nuvem antes de apagar qualquer coisa.
7. **Editar um título** descartava a imagem larga, o tipo TMDB e a nota; o salvamento de temporadas descartava ID, número e imagem dos episódios.
8. Miniaturas de episódio eram caixas verticais com a imagem espremida (agora 16:9).
9. O painel da comunidade mostrava dados do título anterior ao trocar de título.
10. `100dvh` sem alternativa em `vh` podia deixar a janela de detalhes sem altura definida (e sem rolagem) em navegadores que não conhecem `dvh`, como o Chromium 94 de TVs de 2023.
11. O histórico era gravado sem a chave do perfil ao sincronizar a conta.
12. Botões com ícone perdiam o ícone quando o texto mudava (login admin, exclusão em massa).
13. “Restaurar exemplos” (sem exemplos há muito tempo) agora é “Limpar cache local” e não apaga lista nem progresso.
14. Atribuir `iframe.src` criava entradas no histórico: o botão Voltar “andava” dentro do player.
15. As cópias do catálogo (dedupe) deixavam referências antigas na interface.
16. O catálogo de demonstração entrava sempre antes dos dados reais.
17. O histórico recalculava recomendações sem necessidade.
18. Compartilhar não levava ao título (agora leva).
19. O arquivo `_headers` tinha uma linha em branco que podia separar um cabeçalho do bloco.
20. A busca não ordenava por relevância (título que começa com o termo agora vem primeiro).

### Limpeza
- Removidos: 8 capas SVG de demonstração e o código que as usava, `ETAPA-24-CORRECAO-TEMPORADAS.md`, o ícone PNG de 128 px (substituído por SVG e PNGs nítidos), banner e botões duplicados, `datalist` nativo.
- README reduzido (de 24 etapas acumuladas para o essencial); SQL em `database/`, documentos em `docs/`.

## Antes da 7.0 (resumo)
Versões 5.0 a 6.6 (etapas 1 a 24) trouxeram: contas e sincronização, perfis locais, comunidade (avaliações, comentários, denúncias, moderação e auditoria), busca inteligente, player melhorado, editor visual de temporadas, importação em massa do TMDB, TV ao vivo e otimizações para Samsung Tizen.
