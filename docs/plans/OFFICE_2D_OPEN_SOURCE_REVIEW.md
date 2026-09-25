# Office 2D — pesquisa open source e decisão arquitetural

Data: 2026-09-23

## Opções avaliadas
- https://github.com/ashawareb/the-office — MIT. React + Phaser 3; referência útil de escritório pixel-art orientado a estado de agentes.
- https://github.com/fedevgonzalez/pixel-office — MIT conforme documentação do projeto/base; referência de agentes em escritório.
- https://github.com/pixijs/pixijs — MIT. Engine 2D madura, mas desnecessária para a escala atual do Agent Office.
- https://github.com/lass-machen/meetropolis — AGPL-3.0 + MIT por partes; escopo muito maior que o necessário.
- https://github.com/forge-ai-gg/forgeai-characters — assets sob licenças variadas (CC0/CC-BY/CC-BY-SA/OGA-BY/GPL), exigindo rastreio por asset.

## Decisão
Não incorporar código, sprites ou tiles externos neste checkpoint.

Motivos:
1. O Office atual já é React e recebe estado real do backend.
2. Phaser/Pixi adicionariam peso e lifecycle próprio sem ganho proporcional neste estágio.
3. O objetivo operacional não exige movimentação livre, colisão ou gameplay.
4. CSS/DOM com componentes pequenos permite uma cena rica, acessível e barata.
5. Evita risco de misturar assets com licenças/atribuições diferentes.

Somente padrões conceituais foram usados: zoneamento espacial, estações por função, personagens distintos e sinalização de estado.

Nenhum asset, sprite, mapa, código ou arte proprietária do Gather foi copiado.

## Licenças adicionadas
Nenhuma dependência ou asset externo foi adicionado nesta implementação.
