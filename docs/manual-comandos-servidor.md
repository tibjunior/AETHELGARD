# Manual — Página "Comandos do Servidor" (Admin)

A aba **Comandos do Servidor** no painel GM (`http://localhost:5173/admin.html`)
permite ajustar em tempo real todas as taxas, tempos e regras que regem o
funcionamento do jogo Aethelgard — sem precisar reiniciar o servidor.

---

## Índice

1. [Como acessar e usar](#1-como-acessar-e-usar)
2. [Ações Rápidas](#2-ações-rápidas)
   * 2.1 Broadcast Global
   * 2.2 Controle Climático (Tempo)
3. [Configuração do Servidor — visão geral](#3-configuração-do-servidor--visão-geral)
4. [Cartões de configuração](#4-cartões-de-configuração)
   * 4.1 [⚔️ Combate & Drops](#41-%EF%B8%8F-combate--drops)
   * 4.2 [⭐ Experiência por Monstro](#42--experiência-por-monstro)
   * 4.3 [🏦 Banco](#43--banco)
   * 4.4 [💚 Regeneração (HP / Mana)](#44--regeneração-hp--mana)
   * 4.5 [🎒 Inventário](#45--inventário)
   * 4.6 [💀 Respawn](#66--respawn)
   * 4.7 [🌗 Ciclo Dia / Noite](#67--ciclo-dia--noite)
   * 4.8 [🛡️ PvP & Safe Zone](#68--pvp--safe-zone)
   * 4.9 [⏱️ ASPD & Cooldowns](#69--%EF%B8%8F-aspd--cooldowns)
   * 4.10 [📦 Tabelas de Drop (peso relativo)](#410--tabelas-de-drop-peso-relativo)
5. [Botões de ação da página de config](#5-botões-de-ação-da-página-de-config)
6. [Boas práticas e armadilhas](#6-boas-práticas-e-armadilhas)
7. [Solução de problemas](#7-solução-de-problemas)
8. [Onde os dados ficam salvos](#8-onde-os-dados-ficam-salvos)

---

## 1. Como acessar e usar

1. Abra no navegador: `http://localhost:5173/admin.html`
2. Faça login com uma conta que tenha permissão de GM (ou com a conta padrão
   `AdminGM` que o painel usa para auto-login).
3. Na barra lateral, clique em **"Comandos do Servidor"**.
4. A página carrega automaticamente a config atual do servidor do banco
   (campos já preenchidos com os valores em vigor).
5. Edite os campos desejados.
6. Clique em **💾 Salvar e Aplicar** no final da página.
7. A configuração é gravada no banco e propagada a todos os jogadores
   **instantaneamente** (na próxima ação que o servidor executar).

> 💡 Se a página parecer vazia, clique em **🔄 Recarregar do Banco** para
> puxar a config mais recente.

---

## 2. Ações Rápidas

São atalhos que não dependem de "salvar" — a ação é executada na hora.

### 2.1 Broadcast Global

Envia uma mensagem de aviso que aparece na tela e no log de chat de **todos**
os jogadores online.

| Campo      | Descrição                                |
|------------|------------------------------------------|
| Mensagem   | Texto livre (use com moderação).         |

Exemplo: `Boss Nightmare Skeleton apareceu no Deserto! Corram!`

### 2.2 Controle Climático (Tempo)

Força a hora do dia para todos os jogadores.

| Botão             | Efeito                           |
|-------------------|----------------------------------|
| ☀️ Forçar Dia     | Ilumina o mapa inteiro.          |
| 🌙 Forçar Noite   | Aciona Fog of War / mecânicas noturnas. |

> A cada novo ciclo, o servidor volta ao cálculo normal de tempo.
> Use apenas para testes ou eventos rápidos.

---

## 3. Configuração do Servidor — visão geral

A página tem **9 cartões temáticos** + um cartão de **Drop Tables** + um
cartão de **ações (Salvar/Recarregar/Resetar)**.

A maioria dos campos é autoexplicativa, mas alguns têm regras especiais
listadas abaixo. Todos os valores são validados no momento do salvamento
(se um campo tiver valor inválido, o servidor emite mensagem de erro).

---

## 4. Cartões de configuração

### 4.1 ⚔️ Combate & Drops

| Campo                            | Tipo    | Padrão | Descrição |
|----------------------------------|---------|--------|-----------|
| Multiplicador de Gold (por nível)| número  | `1`    | Gold ganho = `monster.level × valor`. Ex: monstro Lv 3 com `1` = 3 gold; com `2` = 6 gold. |
| Gold por Kill PvP                | número  | `10`   | Quantia fixa de gold entregue ao vencedor de uma kill PvP. Vai direto para o inventário de gold (não dropa no chão). |
| Chance de perder item na morte PvP | decimal 0.0–1.0 | `0.30` | Probabilidade do **perdedor** dropar 1 item aleatório da mochila no chão. `0` = nunca perde; `1` = sempre perde. |
| Item drop do Boss (Nightmare Skeleton) | texto | `Armor` | Item garantido que o boss dropa. Útil se quiser trocar a loot table do boss por evento sazonal. |

**Receita rápida — servidor "duro":**

```
goldByLevel = 1
pvpGoldReward = 10
pvpItemLossChance = 0.30
```

**Receita rápida — servidor "fácil":**

```
goldByLevel = 2
pvpGoldReward = 50
pvpItemLossChance = 0.10
```

---

### 4.2 ⭐ Experiência por Monstro

Define a EXP ganha ao matar cada tipo de monstro.

| Monstro              | EXP padrão | Notas |
|----------------------|------------|-------|
| Giant Rat (Lv 1)     | 50         | Monstro inicial. |
| Orc (Lv 3)           | 150        | Primeira parede para novatos. |
| Rotworm (Lv 5)       | 250        | Zona intermediária. |
| Demon Skeleton (Lv 10) | 600      | End-game. |
| Nightmare Skeleton (Boss) | 5000 | Boss noturno. |

> A EXP necessária para subir de nível é calculada em
> `shared/types.ts` (`experienceToLevel`). Esses valores definem **quanto
> cada kill contribui**, não o custo de subir de nível.

**Dica:** se quiser acelerar a progressão, dobre todos os valores.

---

### 4.3 🏦 Banco

| Campo                          | Padrão | Descrição |
|--------------------------------|--------|-----------|
| Tarifa diária (gold)           | `1`    | Gold cobrado por dia que o jogador está **offline** com gold no banco. |
| Limite de dívida (dias)        | `-20`  | Quando a dívida acumulada atinge esse limite (negativo), o banco é **bloqueado**. Padrão: -20 → bloqueia após 20 dias sem pagar. |
| Quantidade de slots            | `50`   | Tamanho do banco do jogador. |
| Distância para interagir (tiles) | `2`  | Distância máxima do NPC Banker para abrir o banco. Aumente se o NPC mudar de posição. |

**Exemplo de cobrança diária:**

```
banco: 100 gold
tarifa: 1
dívida após 5 dias: -5
```

Quando o jogador logar, ele paga a dívida (até zerar) ou toma bloqueio
se passar de `-20`.

---

### 4.4 💚 Regeneração (HP / Mana)

Regeneração ocorre em **ticks**. O padrão é 40 ticks = 2 segundos.

| Campo                                  | Padrão | Descrição |
|----------------------------------------|--------|-----------|
| HP base por tick                       | `2`    | HP regenerado por tick **fora de combate** (em safe zone, é 100%). |
| HP bônus a cada X pontos de VIT        | `5`    | A cada `5` pontos de VIT, regenera 1 HP extra por tick. |
| SP base por tick                       | `1`    | SP regenerado por tick. |
| SP bônus a cada X pontos de INT        | `5`    | A cada `5` pontos de INT, regenera 1 SP extra por tick. |
| Intervalo de tick (20 = 1s)            | `40`   | A cada 2s. Diminua para 20 (1s) para regen mais rápida em servidores "casuais". |

> ⚠️ Em **safe zone** (dentro dos limites da cidade), a regeneração é
> **instantânea para o máximo**. A config acima só afeta o mundo aberto.

**Cálculo exemplo (personagem com VIT 25, INT 10):**

```
HP/tick = 2 + floor(25/5) = 2 + 5 = 7 HP a cada 2s
SP/tick = 1 + floor(10/5) = 1 + 2 = 3 SP a cada 2s
```

---

### 4.5 🎒 Inventário

| Campo                       | Padrão | Descrição |
|-----------------------------|--------|-----------|
| Máx. stack por slot         | `99`   | Quantos itens iguais cabem no mesmo slot. |
| Capacidade base (sem mochila) | `8`  | Slots quando o jogador não tem mochila equipada. |
| Leather Backpack            | `16`   | Slots ao equipar `Leather Backpack`. |
| Wooden Backpack             | `24`   | Slots ao equipar `Wooden Backpack`. |
| Iron Backpack               | `32`   | Slots ao equipar `Iron Backpack` (top tier). |
| Capacidade de carga (oz)    | `250`  | Peso máximo carregado. Cada item tem um peso (ver `ITEM_WEIGHTS`). |

> Os slots totais do inventário são definidos pelo tipo de mochila
> equipada, **não** somam ao base. Ex: com Leather, o jogador tem
> 16 slots (não 16+8).

**Itens stackable por padrão:** `Apple, Cheese, Health Potion, Mana Potion,
Blueberry, Iron Ore, Wood Log, Medicinal Herb, Leather Hide, Gold Coin`.

---

### 4.6 💀 Respawn

| Campo                          | Padrão  | Descrição |
|--------------------------------|---------|-----------|
| Tempo até reviver (ms)         | `5000`  | Após morrer, o jogador volta a vida em 5s. |
| Intervalo de auto-save (ms)    | `10000` | Servidor salva todos os jogadores a cada 10s. |

> ⚠️ **Atenção:** alterar `autoSaveIntervalMs` exige **reiniciar o
> servidor** para valer, pois o intervalo é definido no boot do Game.
> Os outros campos são hot-reload.

---

### 4.7 🌗 Ciclo Dia / Noite

| Campo                              | Padrão | Descrição |
|------------------------------------|--------|-----------|
| Duração do dia (ticks, 20 = 1s)    | `6000` | 5 min de dia = 5 min de noite. |
| Duração da noite (ticks)           | `6000` | Idem. |

**Receita "realista"** (1h dia / 1h noite):
```
dayDurationTicks = 72000
nightDurationTicks = 72000
```

**Receita "speedrun"** (30s cada):
```
dayDurationTicks = 600
nightDurationTicks = 600
```

> Bosses noturnos spawnam assim que o ciclo entra em noite. Ciclos
> muito curtos geram muitos bosses — equilibre a chance na
> config de spawn se aumentar a frequência.

---

### 4.8 🛡️ PvP & Safe Zone

Define o retângulo do mapa onde PvP é **bloqueado** (safe zone = cidade).

| Campo    | Padrão | Descrição |
|----------|--------|-----------|
| X mínimo | `110`  | Tile X do canto superior-esquerdo. |
| X máximo | `130`  | Tile X do canto inferior-direito. |
| Y mínimo | `105`  | Tile Y do canto superior-esquerdo. |
| Y máximo | `120`  | Tile Y do canto inferior-direito. |

A área inclui:
- NPC Merchant
- NPC Banker
- Áreas de crafting

> Para ampliar a safe zone, **aumente** os Xs e Ys. Para reduzir, diminua.
> Certifique-se de que o NPC continua dentro da safe zone se você
> reduzir a área.

---

### 4.9 ⏱️ ASPD & Cooldowns

Velocidade de ataque (Attack Speed) — controla o cooldown entre hits.

| Campo                              | Padrão | Descrição |
|------------------------------------|--------|-----------|
| Cooldown base do Player (ms)       | `1500` | 1.5s entre ataques. |
| Cooldown base do Monstro (ms)      | `2000` | 2s entre ataques. |
| Redução por DES (fator)            | `20`   | Cada ponto de DES subtrai `fator` ms do cooldown (mínimo de 500ms). |

**Fórmula final do cooldown do player:**

```
cooldown = max(500, basePlayerCooldownMs - DES * aspdDesReductionFactor)
```

**Exemplo (jogador com DES 50):**
```
cooldown = max(500, 1500 - 50*20) = max(500, 500) = 500ms
```

**Exemplo (jogador com DES 10):**
```
cooldown = max(500, 1500 - 10*20) = max(500, 1300) = 1300ms
```

> Aumentar o `aspdDesReductionFactor` torna **DES** mais valioso
> (builds focadas em DES atacam mais rápido).
> Para um jogo mais lento, **aumente** o `basePlayerCooldownMs`.

---

### 4.10 📦 Tabelas de Drop (peso relativo)

A última seção da página lista, **para cada monstro**, os itens
que podem ser dropados e seus **pesos relativos**.

**Como funciona a rolagem:**

```
soma = Σ(weight de todos os items da tabela)
rolagem = random() * soma
acumula pesos na ordem; o item que "estourar" a rolagem é o vencedor
```

Exemplo (Giant Rat):
```
Steel Sword   = 5
Torch         = 5
Cheese        = 15
Apple         = 20
Blueberry     = 15
Wood Log      = 15
Medicinal Herb= 15
Leather Hide  = 10
-----------------------
SOMA = 100
```
Cada item tem X% de chance. Aumentar o peso de um item aumenta a chance
em relação aos outros.

**Como usar a interface:**

1. Localize o card do monstro (ex: `👹 Giant Rat`).
2. Mude os valores dos inputs.
3. Clique em **💾 Salvar e Aplicar** no final.

**Receitas comuns:**

- **Tornar drop mais raro:** diminua o peso do item, ou aumente o peso
  dos itens "lixo" (ex: Wood Log).
- **Desativar drop de um item:** coloque `0`. Ele nunca vai dropar.
- **Adicionar item novo:** edite `serverConfig.ts` e reinicie o servidor
  (a interface suporta apenas editar pesos dos itens já existentes).
- **Boss sempre dropa o mesmo item:** mantenha um único item com peso
  `100` (caso do Nightmare Skeleton → `Armor 100`).

---

## 5. Botões de ação da página de config

Localizados no último cartão amarelo, no final da página.

| Botão                       | Cor       | O que faz |
|-----------------------------|-----------|-----------|
| 💾 Salvar e Aplicar         | Verde     | Envia todas as alterações para o servidor. Persiste no banco. Os efeitos são imediatos (próxima ação de jogo usa os novos valores). |
| 🔄 Recarregar do Banco      | Azul      | Descarta as edições locais e puxa a config do banco. Útil se você editou mas mudou de ideia. |
| ⚠️ Resetar para Padrões     | Vermelho  | Reseta **toda** a config para os defaults do código (`DEFAULT_CONFIG` em `serverConfig.ts`) e salva no banco. Pede confirmação. |

> ⚠️ O "Resetar" **sobrescreve** até mudanças que você não havia
> salvo na sessão. Use com cuidado.

---

## 6. Boas práticas e armadilhas

### ✅ Boas práticas

1. **Anote a config atual** antes de fazer mudanças grandes (print ou
   copie os valores para um arquivo de texto). Se algo quebrar, você
   consegue restaurar manualmente.

2. **Teste em pequena escala primeiro.** Mude um único campo, salve,
   observe o impacto, e só então mude o próximo.

3. **Use o botão "Recarregar"** antes de uma sessão de edição longa
   para garantir que está trabalhando sobre a config mais recente
   (caso outro GM tenha mexido).

4. **Cuidado com ciclos dia/noite muito curtos.** Ciclos de menos de
   60s podem spawnar dezenas de bosses por hora. Se quiser um servidor
   "caótico", reduza também a chance em `monsterNightCloneChance`
   (default é 1.0 = sempre).

5. **Backup do banco antes de "Resetar"**:
   ```powershell
   Copy-Item database.sqlite database.sqlite.bak
   ```

### ❌ Armadilhas comuns

| Erro                                              | Consequência |
|---------------------------------------------------|--------------|
| `playerRespawnMs = 0`                             | Jogador revive instantaneamente — quebra o ciclo de morte. |
| `pvpItemLossChance = 1`                           | PvP vira "roubo garantido". Não use em servidores públicos. |
| `regenIntervalTicks = 1`                          | Regen absurdamente rápida — zera HP/SP quase instantaneamente. |
| `cityBounds` englobando só parte do NPC           | Jogador é forçado a ficar fora da safe zone e pode ser morto. |
| `bankSlots = 0`                                   | Jogador perde acesso ao banco. |
| `aspdDesReductionFactor = 1000`                   | Cooldown sempre em 500ms — PvP vira click-fest. |
| Esquecer de `maxStackSize = 99`                   | Itens stackable ficam 1 por slot — mochilas lotam rápido. |

---

## 7. Solução de problemas

| Sintoma                                              | Causa provável                                    | Solução |
|------------------------------------------------------|---------------------------------------------------|---------|
| Campos da página estão vazios                        | Banco de dados não tem `server_config` salvo      | Clique em 🔄 Recarregar. Se persistir, verifique se o servidor está rodando. |
| Alterei mas o jogo não mudou                          | Você esqueceu de clicar em **Salvar**             | Clique em 💾 Salvar e Aplicar. |
| Servidor não inicia com config nova                  | JSON inválido salvo no banco                      | Delete `database.sqlite` (perde contas) **ou** delete a linha `server_config` para resetar. |
| Boss não spawna                                      | `bossSpawnChancePerNight = 0`                     | Ajuste para `1.0` (sempre spawna). |
| Monstros não clonam à noite                          | `monsterNightCloneChance = 0`                     | Ajuste para `1.0` (sempre clona). |
| Mudou `autoSaveIntervalMs` e nada mudou              | Esse campo exige reinício do servidor             | Reinicie `tsx watch`. |
| Cliquei em Reset e quero minha config antiga de volta | Banco foi sobrescrito                            | Se você tinha um backup, restaure `database.sqlite.bak`. Senão, edite manualmente e salve. |

---

## 8. Onde os dados ficam salvos

| Item                              | Local                                       |
|-----------------------------------|---------------------------------------------|
| Configuração atual                | Tabela `server_config` em `database.sqlite` |
| Defaults (código)                 | `server/src/core/serverConfig.ts:71-164`    |
| UI da página                      | `client/admin.html` + `client/src/admin.ts` |
| Handlers de socket                | `server/src/core/Game.ts:2877-2905`         |

**Estrutura da linha no banco (chave `main`):**

```json
{
  "goldByLevel": 1,
  "pvpGoldReward": 10,
  "pvpItemLossChance": 0.3,
  "bossArmorDrop": "Armor",
  "bankDailyFee": 1,
  "bankMaxDebtDays": -20,
  "bankSlots": 50,
  "bankDistanceCheck": 2,
  "hpRegenBase": 2,
  "hpRegenPerVit": 5,
  "spRegenBase": 1,
  "spRegenPerInt": 5,
  "regenIntervalTicks": 40,
  "maxStackSize": 99,
  "backpackBaseSlots": 8,
  "backpackLeatherSlots": 16,
  "backpackWoodenSlots": 24,
  "backpackIronSlots": 32,
  "maxWeightBase": 250,
  "playerRespawnMs": 5000,
  "autoSaveIntervalMs": 10000,
  "dayDurationTicks": 6000,
  "nightDurationTicks": 6000,
  "cityBounds": { "xMin": 110, "xMax": 130, "yMin": 105, "yMax": 120 },
  "basePlayerCooldownMs": 1500,
  "baseMonsterCooldownMs": 2000,
  "aspdDesReductionFactor": 20,
  "expByMonster": { "Giant Rat": 50, "Orc": 150, ... },
  "dropTables": { "Giant Rat": { "Steel Sword": 5, ... }, ... }
}
```

> O JSON é gravado com `INSERT ... ON CONFLICT(key) DO UPDATE` (upsert).
> A chave é sempre `"main"` — não há múltiplas configs.

---

## Apêndice — Onde cada config é lida no código

Para referência avançada, eis os pontos do `server/src/core/Game.ts` que
consomem o `CONFIG`:

| Config                       | Local no Game.ts                |
|------------------------------|---------------------------------|
| `dropTables` + `rollDropTable` | Bloco de loot ao matar monstro |
| `expByMonster`               | Mesmo bloco, atribui EXP        |
| `goldByLevel`                | Cálculo de gold direto          |
| `pvpGoldReward`              | Kill PvP                        |
| `pvpItemLossChance`          | Drop aleatório de item em PvP   |
| `hpRegenBase/PerVit`         | Loop de regen (tick)            |
| `spRegenBase/PerInt`         | Loop de regen (tick)            |
| `regenIntervalTicks`         | Frequência do loop de regen     |
| `bankSlots`                  | `addItemToBank`                 |
| `bankDistanceCheck`          | 8 checagens de distância        |
| `bankDailyFee`/`bankMaxDebtDays` | `deductOfflineBankGold`      |
| `maxStackSize`               | Empilhamento de itens           |
| `backpack*Slots`             | Lógica de mochila               |
| `maxWeightBase`              | Cálculo de peso                 |
| `playerRespawnMs`            | `respawnPlayer`                 |
| `dayDurationTicks`/`nightDurationTicks` | `updateDayNightCycle`  |
| `cityBounds`                 | Safe zone check (regen + PvP)   |
| `basePlayerCooldownMs`       | Cálculo de ASPD                 |
| `baseMonsterCooldownMs`      | Cálculo de ASPD de monstro      |
| `aspdDesReductionFactor`     | Fórmula `cooldown - DES*factor` |
| `autoSaveIntervalMs`         | Boot do servidor                |

---

_Documento escrito para o build local de desenvolvimento. Última
revisão: Fase 2 — Config central._
