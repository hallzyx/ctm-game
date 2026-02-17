# 🪨✋✌️ Gawi Bawi Bo ZK — Guía de la Dapp

> **Korean Double Rock-Paper-Scissors con Zero-Knowledge Commitments en Stellar**

---

## 📋 Índice

1. [Visión General](#1-visión-general)
2. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
3. [Flujo del Juego (5 Fases)](#3-flujo-del-juego-5-fases)
4. [Smart Contract (Soroban)](#4-smart-contract-soroban)
5. [Circuitos Noir (ZK)](#5-circuitos-noir-zk)
6. [Frontend (React + TypeScript)](#6-frontend-react--typescript)
7. [Integración Criptográfica](#7-integración-criptográfica)
8. [Despliegue e Infraestructura](#8-despliegue-e-infraestructura)
9. [Guía de Desarrollo](#9-guía-de-desarrollo)
10. [Seguridad y Consideraciones](#10-seguridad-y-consideraciones)

---

## 1. Visión General

### ¿Qué es Gawi Bawi Bo ZK?

**Gawi Bawi Bo** (가위바위보) es la versión coreana de Piedra-Papel-Tijera, con un giro estratégico: cada jugador presenta **dos manos diferentes** y luego elige secretamente cuál conservar para el duelo final. La mecánica ZK (Zero-Knowledge) garantiza que los compromisos sean verificables on-chain sin revelar información prematuramente.

### Mecánica del Juego

1. **Lanzamiento Doble**: Cada jugador elige 2 figuras RPS diferentes (ej: 🪨 + ✋)
2. **Revelación**: Ambos revelan sus manos simultáneamente
3. **Hana Ppegi** (하나 빼기 — "quitar uno"): Cada jugador ve las 4 manos y elige secretamente cuál de sus 2 manos conservar
4. **Duelo Final**: Las manos conservadas se enfrentan en RPS clásico

### Stack Tecnológico

| Componente | Tecnología | Versión |
|---|---|---|
| Smart Contract | Soroban SDK (Rust → WASM) | 25.0.2 |
| ZK Circuits | Noir DSL | 1.0.0-beta.9 |
| ZK Backend | Barretenberg (UltraHonk) | 0.87.0 |
| Frontend | React + TypeScript + Vite | 19 / 5.9 / 7.3 |
| Blockchain | Stellar Testnet | — |
| Crypto (cliente) | js-sha3 (keccak256) | 0.9.3 |
| Estado (cliente) | Zustand | 5.x |
| Estilos | Tailwind CSS | 4.x |

---

## 2. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (React)                    │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │CtmGame.tsx│  │ctmService.ts │  │  js-sha3 keccak  │  │
│  │(UI/phases)│→ │(contract I/O)│→ │  (hash matching)  │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
│        │              │                                  │
│        │        ┌─────▼─────┐                           │
│        │        │ bindings.ts│  ← auto-generated         │
│        │        └─────┬─────┘                           │
└────────│──────────────│─────────────────────────────────┘
         │              │
    ┌────▼──────────────▼───────────────┐
    │         STELLAR TESTNET           │
    │  ┌─────────────────────────────┐  │
    │  │   CTM Contract (WASM)      │  │
    │  │   CDM2VXX...EQLJUQ         │  │
    │  │                             │  │
    │  │  start_game ←→ GameHub     │  │
    │  │  commit_hands (keccak256)  │  │
    │  │  reveal_hands (verify)     │  │
    │  │  commit_choice (keccak256) │  │
    │  │  reveal_choice (resolve)   │  │
    │  └───────────┬─────────────────┘  │
    │              │                    │
    │  ┌───────────▼─────────────────┐  │
    │  │   GameHub Contract          │  │
    │  │   CB4VZAT...2EMYG           │  │
    │  │   start_game / end_game     │  │
    │  └─────────────────────────────┘  │
    └───────────────────────────────────┘
         │
    ┌────▼──────────────────────────────┐
    │       NOIR ZK CIRCUITS            │
    │  ┌─────────────┐ ┌─────────────┐  │
    │  │hands_commit │ │choice_commit│  │
    │  │  (off-chain │ │  (off-chain │  │
    │  │   proving)  │ │   proving)  │  │
    │  └─────────────┘ └─────────────┘  │
    └───────────────────────────────────┘
```

### Componentes Principales

| Archivo | Descripción | Líneas |
|---|---|---|
| `contracts/ctm/src/lib.rs` | Smart contract Soroban con 5 fases de juego | ~400 |
| `contracts/ctm/src/test.rs` | 13 tests unitarios completos | ~300 |
| `contracts/ctm/noir/hands_commit/` | Circuito ZK para commit de manos | 70 |
| `contracts/ctm/noir/choice_commit/` | Circuito ZK para commit de elección | 57 |
| `ctm-frontend/src/games/ctm/CtmGame.tsx` | Componente React principal del juego | ~350 |
| `ctm-frontend/src/games/ctm/ctmService.ts` | Capa de servicio (cripto + contract I/O) | ~464 |
| `ctm-frontend/src/games/ctm/bindings.ts` | Bindings TypeScript autogenerados | 214 |

---

## 3. Flujo del Juego (5 Fases)

```
  Fase 0          Fase 1           Fase 2          Fase 3           Fase 4          Fase 5
┌─────────┐   ┌────────────┐   ┌───────────┐   ┌────────────┐   ┌────────────┐   ┌──────────┐
│ Crear   │──▶│ Commit     │──▶│ Reveal    │──▶│ Commit     │──▶│ Reveal     │──▶│ Complete │
│ Partida │   │ Hands      │   │ Hands     │   │ Choice     │   │ Choice     │   │ (Winner) │
│         │   │            │   │           │   │            │   │            │   │          │
│ P1 + P2 │   │ hash(L,R,s)│   │ L,R,salt  │   │ hash(C,s)  │   │ C,salt     │   │ RPS →    │
│ multi-  │   │ both       │   │ verify    │   │ both       │   │ verify +   │   │ winner   │
│ sig     │   │ commit     │   │ hash      │   │ commit     │   │ resolve    │   │          │
└─────────┘   └────────────┘   └───────────┘   └────────────┘   └────────────┘   └──────────┘
     │              │                │                │                │               │
  GameHub        keccak256       verify hash      keccak256       verify hash       GameHub
  start_game     on-chain        on-chain         on-chain        + RPS logic      end_game
```

### Fase 0: Creación de la Partida

- **Multi-sig**: Requiere `require_auth` de **ambos** jugadores
- Player 1 prepara y firma un `auth_entry` → lo envía a Player 2
- Player 2 importa, firma su parte → envía la transacción
- El contrato llama `hub.start_game(session_id, player1, player2)`
- Estado: `phase = 1`

### Fase 1: Commit de Manos (🔒)

Cada jugador elige **dos figuras RPS diferentes** y calcula:

```
commitment = keccak256(left_hand || right_hand || salt)
```

- `left_hand`, `right_hand`: u8 en {0=Rock, 1=Paper, 2=Scissors}
- `salt`: 32 bytes aleatorios (generados con `crypto.getRandomValues`)
- El hash se envía on-chain; las manos permanecen secretas
- Cuando **ambos** jugadores commitean → `phase = 2`

### Fase 2: Reveal de Manos (👁)

Cada jugador envía `(left_hand, right_hand, salt)` en texto plano:

```rust
let computed = hash_hands(&env, left_hand, right_hand, salt.clone());
if computed != stored_commit { return Err(Error::HashMismatch); }
```

- El contrato recalcula el hash y lo compara con el commitment
- Verifica: `0 ≤ hand ≤ 2` y `left ≠ right`
- Cuando **ambos** revelan → las 4 manos son visibles → `phase = 3`

### Fase 3: Commit de Elección (🧠)

El momento estratégico: cada jugador ve las 4 manos y decide cuál de **sus** dos manos conservar:

```
choice_commitment = keccak256(choice_index || salt)
```

- `choice_index`: 0 = mano izquierda, 1 = mano derecha
- Nuevo salt de 32 bytes (diferente al de fase 1)
- Cuando **ambos** commitean → `phase = 4`

### Fase 4: Reveal de Elección + Resolución (🎯)

Cada jugador revela su `choice_index` y `salt`:

```rust
let p1_kept = if p1_choice == 0 { game.p1_left } else { game.p1_right };
let p2_kept = if p2_choice == 0 { game.p2_left } else { game.p2_right };
let winner = if rps_beats(p1_kept, p2_kept) || p1_kept == p2_kept { player1 } else { player2 };
```

- Resolución RPS clásica: Rock > Scissors, Scissors > Paper, Paper > Rock
- **Empate**: Player 1 gana (tiebreaker)
- El contrato llama `hub.end_game(session_id, winner, loser)`
- Estado: `phase = 5`

### Fase 5: Juego Completo (🏆)

- El ganador y las manos finales son visibles on-chain
- Los puntos se transfieren vía GameHub
- El frontend muestra el resultado y permite crear un nuevo juego

---

## 4. Smart Contract (Soroban)

### Estructura del Contrato (`lib.rs`)

```rust
#[contracttype]
pub struct Game {
    player1: Address,
    player2: Address,
    player1_points: i128,
    player2_points: i128,
    phase: u32,                         // 1-5
    p1_commit: Option<BytesN<32>>,      // keccak256 hash
    p2_commit: Option<BytesN<32>>,
    p1_left: Option<u32>,               // 0=Rock, 1=Paper, 2=Scissors
    p1_right: Option<u32>,
    p2_left: Option<u32>,
    p2_right: Option<u32>,
    p1_choice_commit: Option<BytesN<32>>,
    p2_choice_commit: Option<BytesN<32>>,
    p1_kept: Option<u32>,
    p2_kept: Option<u32>,
    winner: Option<Address>,
    points: i128,
}
```

### Funciones Exportadas (12 total)

| Función | Fase | Auth | Descripción |
|---|---|---|---|
| `start_game` | 0→1 | P1 + P2 | Crea sesión, registra en GameHub |
| `commit_hands` | 1 | Player | Envía hash keccak256 de 2 manos |
| `reveal_hands` | 2 | Player | Revela manos, verifica hash |
| `commit_choice` | 3 | Player | Envía hash keccak256 de elección |
| `reveal_choice` | 4→5 | Player | Revela elección, resuelve RPS |
| `get_game` | Cualq. | — | Consulta estado (read-only) |
| `get_admin` | — | — | Obtiene admin |
| `set_admin` | — | Admin | Cambia admin |
| `get_hub` | — | — | Obtiene dirección GameHub |
| `set_hub` | — | Admin | Cambia GameHub |
| `upgrade` | — | Admin | Actualiza WASM del contrato |

### Códigos de Error

| Código | Nombre | Causa |
|---|---|---|
| 1 | `GameNotFound` | Session ID no existe |
| 2 | `NotPlayer` | Dirección no es jugador de la partida |
| 3 | `WrongPhase` | Acción fuera de la fase correcta |
| 4 | `AlreadyCommitted` | Jugador ya envió commitment |
| 5 | `InvalidHand` | Valor de mano > 2 |
| 6 | `HandsMustDiffer` | Ambas manos son la misma figura |
| 7 | `HashMismatch` | Reveal no coincide con commitment |
| 8 | `InvalidChoice` | Índice de elección > 1 |
| 9 | `GameAlreadyEnded` | Partida ya completada |

### Funciones Hash (Preimage Layout)

```rust
// Hash de manos: 34 bytes
fn hash_hands(env: &Env, left: u32, right: u32, salt: BytesN<32>) -> BytesN<32> {
    let mut preimage = Bytes::new(env);
    preimage.push_back(left as u8);    // byte 0
    preimage.push_back(right as u8);   // byte 1
    preimage.append(&salt.into());     // bytes 2-33
    env.crypto().keccak256(&preimage).into()
}

// Hash de elección: 33 bytes
fn hash_choice(env: &Env, choice: u32, salt: BytesN<32>) -> BytesN<32> {
    let mut preimage = Bytes::new(env);
    preimage.push_back(choice as u8);  // byte 0
    preimage.append(&salt.into());     // bytes 1-32
    env.crypto().keccak256(&preimage).into()
}
```

### Tests (13 tests, 100% passing)

```
test test_complete_game_p1_wins        ✓  Rock vs Scissors
test test_complete_game_p2_wins        ✓  Rock vs Paper
test test_draw_p1_wins_tiebreak        ✓  Paper vs Paper → P1 tiebreak
test test_keep_right_hand              ✓  Verificar selección mano derecha
test test_phase_enforcement            ✓  No se puede commit antes de start
test test_invalid_hands_rejected       ✓  Valor > 2 rechazado
test test_same_hands_rejected          ✓  Mismas manos rechazadas
test test_hash_mismatch_rejected       ✓  Hash incorrecto rechazado
test test_double_commit_rejected       ✓  Doble commit rechazado
test test_not_player_rejected          ✓  Tercero no puede jugar
test test_invalid_choice_rejected      ✓  Elección > 1 rechazada
test test_all_rps_outcomes             ✓  6 combinaciones RPS verificadas
test test_phase_transitions            ✓  Transiciones 1→2→3→4→5
```

---

## 5. Circuitos Noir (ZK)

### ¿Por qué Noir?

Los circuitos Noir permiten generar **pruebas de conocimiento cero** (ZK proofs) que verifican la validez de un commitment **sin revelar** los valores secretos. Esto añade una capa adicional de verificabilidad off-chain.

### Circuit: `hands_commit`

```noir
fn main(
    left_hand: u8,      // privado: mano izquierda (0-2)
    right_hand: u8,     // privado: mano derecha (0-2)
    salt: [u8; 32],     // privado: salt aleatorio
    commitment: pub [u8; 32]  // público: hash esperado
) {
    // 1. Validar manos
    assert(left_hand < 3);
    assert(right_hand < 3);
    assert(left_hand != right_hand);

    // 2. Construir preimage y hashear
    let mut preimage: [u8; 34] = [0; 34];
    preimage[0] = left_hand;
    preimage[1] = right_hand;
    for i in 0..32 { preimage[i + 2] = salt[i]; }

    let hash = std::hash::keccak256(preimage, 34);

    // 3. Verificar match
    assert(hash == commitment);
}
```

**Lo que prueba**:
- ✅ Ambas manos son figuras RPS válidas (0, 1 o 2)
- ✅ Las manos son **diferentes** entre sí
- ✅ El hash keccak256 del preimage coincide con el commitment on-chain

### Circuit: `choice_commit`

```noir
fn main(
    choice_index: u8,        // privado: 0=izquierda, 1=derecha
    salt: [u8; 32],          // privado: salt aleatorio
    commitment: pub [u8; 32] // público: hash esperado
) {
    assert(choice_index < 2);

    let mut preimage: [u8; 33] = [0; 33];
    preimage[0] = choice_index;
    for i in 0..32 { preimage[i + 1] = salt[i]; }

    let hash = std::hash::keccak256(preimage, 33);
    assert(hash == commitment);
}
```

**Lo que prueba**:
- ✅ La elección es válida (0 o 1)
- ✅ El hash coincide con el commitment on-chain

### Compilación y Prueba de Circuitos

```bash
# Requiere Noir toolchain
# Instalar: https://noir-lang.org/docs/getting_started/noir_installation

cd contracts/ctm/noir/hands_commit
nargo compile              # Genera ACIR
nargo test                 # Ejecuta test embebido
nargo prove                # Genera prueba ZK (requiere Prover.toml)
nargo verify               # Verifica prueba

cd ../choice_commit
nargo compile && nargo test
```

### Integración Futura: On-chain Verification

El repositorio `rs-soroban-ultrahonk` en Noirlang-Experiments demuestra cómo verificar pruebas UltraHonk **dentro de un contrato Soroban**:

```rust
// Pseudocódigo - integración futura
pub fn verify_hands_proof(
    env: Env,
    proof: Bytes,
    public_inputs: Vec<Bytes>,
) -> bool {
    let vk = env.storage().instance().get(&VK_KEY);
    ultrahonk_verify(env, vk, proof, public_inputs)
}
```

Esto permitiría que el contrato **verifique la prueba ZK on-chain** además de la verificación de hash, eliminando la necesidad de confiar en el cliente.

---

## 6. Frontend (React + TypeScript)

### Estructura de Archivos

```
ctm-frontend/src/games/ctm/
├── bindings.ts     # Tipos e interfaz Client auto-generados
├── ctmService.ts   # Capa de servicio (crypto + contract I/O)
└── CtmGame.tsx     # Componente React principal
```

### ctmService.ts — Capa de Servicio

#### Funciones Criptográficas

```typescript
// Genera 32 bytes aleatorios para salt
generateSalt(): Uint8Array

// keccak256(left_u8 || right_u8 || salt_32) → Buffer de 32 bytes
computeHandsHash(left: number, right: number, salt: Uint8Array): Buffer

// keccak256(choice_u8 || salt_32) → Buffer de 32 bytes
computeChoiceHash(choiceIndex: number, salt: Uint8Array): Buffer
```

#### Persistencia de Secretos (localStorage)

Los salts y valores secretos se guardan en `localStorage` para sobrevivir recargas de página:

```typescript
saveHandsData(sessionId, left, right, salt)  // gwb-zk-hands-{id}
loadHandsData(sessionId)                      // → {left, right, salt} | null
saveChoiceData(sessionId, choice, salt)       // gwb-zk-choice-{id}
loadChoiceData(sessionId)                     // → {choice, salt} | null
clearGameData(sessionId)                      // Limpia ambos
```

#### Clase CtmService

| Método | Descripción |
|---|---|
| `getGame(sessionId)` | Consulta read-only del estado |
| `prepareStartGame(...)` | Multi-sig paso 1: P1 firma auth entry |
| `parseAuthEntry(xdr)` | Extrae sessionId, player1, points del XDR |
| `importAndSignAuthEntry(...)` | Multi-sig paso 2: P2 firma |
| `finalizeStartGame(...)` | Multi-sig paso 3: envía transacción |
| `commitHands(sid, addr, hash, signer)` | Fase 1: envía hash de manos |
| `revealHands(sid, addr, L, R, salt, signer)` | Fase 2: revela manos |
| `commitChoice(sid, addr, hash, signer)` | Fase 3: envía hash de elección |
| `revealChoice(sid, addr, idx, salt, signer)` | Fase 4: revela y resuelve |

### CtmGame.tsx — Componente UI

#### Fases de la UI

```typescript
type UIPhase =
  | 'create'          // Crear partida (3 modos)
  | 'commit_hands'    // Seleccionar 2 manos diferentes
  | 'waiting_commits' // Esperando que oponente commitee
  | 'reveal_hands'    // Clic para revelar manos
  | 'waiting_reveals' // Esperando reveal del oponente
  | 'commit_choice'   // Ver 4 manos, elegir cuál conservar
  | 'waiting_choices' // Esperando elección del oponente
  | 'reveal_choice'   // Clic para revelar elección
  | 'waiting_final'   // Esperando reveal del oponente
  | 'complete';       // Mostrar ganador
```

#### Derivación de Fase

La fase UI se deriva **automáticamente** del estado on-chain:

```typescript
function deriveUIPhase(game: Game, userAddress: string): UIPhase {
  const isP1 = game.player1 === userAddress;
  switch (game.phase) {
    case 1: return myCommit != null ? 'waiting_commits' : 'commit_hands';
    case 2: return myLeft != null ? 'waiting_reveals' : 'reveal_hands';
    case 3: return myChoiceCommit != null ? 'waiting_choices' : 'commit_choice';
    case 4: return myKept != null ? 'waiting_final' : 'reveal_choice';
    case 5: return 'complete';
  }
}
```

#### 3 Modos de Creación

1. **Create & Export**: Player 1 firma y exporta auth entry XDR
2. **Import Auth Entry**: Player 2 pega el XDR, firma y envía
3. **Load Game**: Cargar partida existente por Session ID

#### Deep Linking

- `?game=ctm&auth=<XDR>` → Auto-importa auth entry
- `?session-id=<ID>` → Auto-carga partida existente

#### Quickstart (Dev Mode)

Ejecuta una partida completa automáticamente con dev wallets:
- Rock + Paper vs Scissors + Rock
- P1 keeps Rock, P2 keeps Scissors
- Resultado: Rock 🪨 > Scissors ✌️ → Player 1 gana

#### Polling

El estado se refresca cada 5 segundos mientras la partida está activa:

```typescript
useEffect(() => {
  if (gamePhase !== 'playing') return;
  loadGameState();
  const id = setInterval(loadGameState, 5000);
  return () => clearInterval(id);
}, [sessionId, gamePhase]);
```

---

## 7. Integración Criptográfica

### Flujo de Commit-Reveal

```
         FRONTEND (js-sha3)              CONTRATO (soroban keccak256)
         ══════════════════              ══════════════════════════════

COMMIT:  salt = crypto.getRandomValues(32)
         hash = keccak256([left, right, ...salt])
         save(sessionId, left, right, salt) → localStorage
         send(hash) ──────────────────────→ store(p1_commit = hash)

REVEAL:  {left, right, salt} = load(sessionId)
         send(left, right, salt) ─────────→ recompute = keccak256(left||right||salt)
                                            assert(recompute == p1_commit) ✓
                                            store(p1_left, p1_right)
```

### Garantías de Seguridad

| Propiedad | Mecanismo |
|---|---|
| **Ocultamiento** | keccak256 hash oculta las manos hasta el reveal |
| **Vinculación** | El hash on-chain no puede ser cambiado post-commit |
| **Integridad** | El contrato verifica `hash(reveal) == commitment` |
| **No auto-juego** | `start_game` requiere `require_auth` de ambas direcciones |
| **Determinismo** | Sin aleatoriedad on-chain; toda la "suerte" está en las decisiones del jugador |

### Preimage Formats (deben coincidir exactamente)

```
Hands:  [left_u8 | right_u8 | salt_32bytes] = 34 bytes
Choice: [choice_u8 | salt_32bytes]           = 33 bytes
```

⚠️ **Crítico**: El layout del preimage DEBE ser idéntico entre `js-sha3` (frontend) y `env.crypto().keccak256()` (contrato). Cualquier diferencia causa `HashMismatch`.

---

## 8. Despliegue e Infraestructura

### Contratos Desplegados (Stellar Testnet)

| Contrato | ID | Uso |
|---|---|---|
| **CTM** (Gawi Bawi Bo) | `CDM2VXXHUAUTC5SKU2GZ5CSQJBAUPC4BOJHJTI2M4XP3CWYGBBEQLJUQ` | Lógica del juego |
| **GameHub** (Mock) | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` | Registro de partidas |

### Compilación del Contrato

```bash
# Desde la raíz del workspace
stellar contract build --manifest-path contracts/ctm/Cargo.toml

# El WASM se genera en:
# target/wasm32v1-none/release/ctm.wasm (~12 KB)
```

### Despliegue

```bash
# Instalar WASM
stellar contract install \
  --wasm target/wasm32v1-none/release/ctm.wasm \
  --source <ADMIN_KEY> \
  --network testnet

# Desplegar contrato
stellar contract deploy \
  --wasm-hash <HASH> \
  --source <ADMIN_KEY> \
  --network testnet

# Inicializar admin y hub
stellar contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet \
  -- set_admin --admin <ADMIN_ADDRESS>

stellar contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network testnet \
  -- set_hub --hub <GAMEHUB_ADDRESS>
```

### Generar Bindings TypeScript

```bash
stellar contract bindings typescript \
  --contract-id <CONTRACT_ID> \
  --network testnet \
  --output-dir /tmp/ctm-bindings

# Copiar el archivo generado
cp /tmp/ctm-bindings/src/index.ts ctm-frontend/src/games/ctm/bindings.ts
```

### Frontend

```bash
cd ctm-frontend
bun install        # Instalar dependencias
bun run dev        # Dev server (puerto 5173)
bun run build      # Build de producción
```

---

## 9. Guía de Desarrollo

### Requisitos Previos

- **Rust** + `wasm32v1-none` target
- **Stellar CLI** (`stellar`)
- **Bun** (o npm/pnpm)
- **Noir** toolchain (opcional, para circuitos ZK)

### Ejecutar Tests del Contrato

```bash
cargo test -p ctm
# ✓ 13 tests en ~0.2s
```

### Flujo Completo de Desarrollo

1. **Editar** `contracts/ctm/src/lib.rs`
2. **Testear** `cargo test -p ctm`
3. **Compilar** `stellar contract build --manifest-path contracts/ctm/Cargo.toml`
4. **Desplegar** (ver sección anterior)
5. **Regenerar bindings** y copiar a frontend
6. **Actualizar** `ctmService.ts` si cambian los métodos
7. **Probar** en frontend con quickstart

### Agregar Nuevas Fases o Lógica

1. Agregar campo al struct `Game` en `lib.rs`
2. Crear nueva función exportada con `#[contractimpl]`
3. Agregar test en `test.rs`
4. Regenerar bindings
5. Agregar método en `ctmService.ts`
6. Agregar UIPhase y renderizado en `CtmGame.tsx`

### Integrar Verificación ZK On-chain (Avanzado)

Para verificar pruebas Noir **dentro del contrato Soroban**:

1. Compilar circuito: `nargo compile`
2. Generar Verification Key
3. Embedir VK en el contrato (storage en deploy)
4. Usar `rs-soroban-ultrahonk` como referencia para el verificador
5. Agregar función `verify_proof(public_inputs, proof)` al contrato
6. Requerir prueba ZK en `commit_hands` / `commit_choice`

---

## 10. Seguridad y Consideraciones

### Riesgos Conocidos

| Riesgo | Mitigación |
|---|---|
| **Salt perdido** | Guardado en localStorage; si se borra, no se puede revelar |
| **Front-running** | Hash commitment previene que el oponente vea la jugada antes de commitear |
| **Tiebreak P1** | En empate, P1 siempre gana (diseño intencional, documentado) |
| **Salt débil** | Usa `crypto.getRandomValues` (CSPRNG) |
| **Replay** | Cada sessionId es único; cada jugador solo puede commitear una vez |

### Reglas de AGENTS.md Cumplidas

- ✅ GameHub integrado (`start_game` / `end_game`)
- ✅ Determinismo (sin aleatoriedad on-chain)
- ✅ TTL temporal (30 días = 518,400 ledgers) para storage
- ✅ Solo 2 jugadores, sin auto-juego
- ✅ `require_auth` para todas las acciones

### Mejoras Futuras

1. **Verificación ZK on-chain** via UltraHonk verifier en Soroban
2. **Timeout**: Penalizar si un jugador no revela en X ledgers
3. **Mejor tiebreak**: Ronda extra en vez de ventaja P1
4. **Chat/notificaciones**: WebSocket para notificar cambios en tiempo real
5. **Torneos**: Brackets multi-ronda con el GameHub

---

## 📝 Licencia

MIT — Ver [LICENSE](../../LICENSE) en la raíz del repositorio.

---

*Generado para el Stellar ZK Games Hackathon — Gawi Bawi Bo ZK v0.1.0*
