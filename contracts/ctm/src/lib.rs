#![no_std]

//! # Gawi Bawi Bo ZK  –  Korean Double Rock-Paper-Scissors
//!
//! A ZK-powered two-player game based on the Korean "double rock-paper-scissors".
//! Each player secretly commits **two different hands**, both hands are revealed,
//! and then each player strategically commits which hand to **keep** for a final
//! classic RPS duel.
//!
//! ## ZK Mechanic
//! Hash-based commit-reveal powered by `keccak256`.  Players prove their
//! commitments are valid (correct pre-image) without revealing selections until
//! the appropriate phase.  Companion Noir circuits can generate off-chain proofs
//! that the committed hands are valid *before* the reveal step.
//!
//! ## Game Phases
//! 1. **CommitHands** – both players submit `keccak256(left || right || salt)`
//! 2. **RevealHands** – both reveal hands + salt; contract verifies hashes
//! 3. **CommitChoice** – both submit `keccak256(choice_index || salt2)`
//! 4. **RevealChoice** – both reveal; contract verifies, resolves RPS, calls GameHub
//! 5. **Complete**
//!
//! ## Game Hub Integration
//! Calls `start_game` and `end_game` on the Game Hub contract.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    vec, Address, Bytes, BytesN, Env, IntoVal,
};

// ============================================================================
// Game Hub Interface
// ============================================================================

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound      = 1,
    NotPlayer         = 2,
    WrongPhase        = 3,
    AlreadyCommitted  = 4,
    InvalidHand       = 5,
    HandsMustDiffer   = 6,
    HashMismatch      = 7,
    InvalidChoice     = 8,
    GameAlreadyEnded  = 9,
}

// ============================================================================
// Data Types
// ============================================================================

/// Hand constants: 0 = Rock 🪨,  1 = Paper ✋,  2 = Scissors ✌️
///
/// Game phases:
///   1 = CommitHands      – waiting for both commit hashes
///   2 = RevealHands      – waiting for both to reveal hands
///   3 = CommitChoice     – waiting for both to commit which hand to keep
///   4 = RevealChoice     – waiting for both to reveal their choice
///   5 = Complete         – winner determined

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    pub phase: u32,

    // Phase 1 – commitment hashes  keccak256(left_hand || right_hand || salt)
    pub p1_commit: Option<BytesN<32>>,
    pub p2_commit: Option<BytesN<32>>,

    // Phase 2+ – revealed hands (0 = rock, 1 = paper, 2 = scissors)
    pub p1_left: Option<u32>,
    pub p1_right: Option<u32>,
    pub p2_left: Option<u32>,
    pub p2_right: Option<u32>,

    // Phase 3 – choice commitment  keccak256(choice_index || salt2)
    pub p1_choice_commit: Option<BytesN<32>>,
    pub p2_choice_commit: Option<BytesN<32>>,

    // Phase 4+ – kept hand value & winner
    pub p1_kept: Option<u32>,
    pub p2_kept: Option<u32>,
    pub winner: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
}

// ============================================================================
// Storage TTL  (30 days ≈ 518 400 ledgers at ~5 s each)
// ============================================================================

const GAME_TTL_LEDGERS: u32 = 518_400;

// ============================================================================
// Helpers
// ============================================================================

/// Build the keccak-256 hash used for a **hands** commitment.
///
/// `preimage = left_hand(1 byte) || right_hand(1 byte) || salt(32 bytes)`
fn hash_hands(env: &Env, left: u32, right: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut pre = Bytes::new(env);
    pre.push_back(left as u8);
    pre.push_back(right as u8);
    pre.append(&Bytes::from_slice(env, &salt.to_array()));
    env.crypto().keccak256(&pre).into()
}

/// Build the keccak-256 hash used for a **choice** commitment.
///
/// `preimage = choice_index(1 byte) || salt(32 bytes)`
fn hash_choice(env: &Env, choice: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut pre = Bytes::new(env);
    pre.push_back(choice as u8);
    pre.append(&Bytes::from_slice(env, &salt.to_array()));
    env.crypto().keccak256(&pre).into()
}

/// Classic Rock-Paper-Scissors resolution.
/// Returns `true` when `hand1` beats `hand2`.
fn rps_beats(hand1: u32, hand2: u32) -> bool {
    (hand1 == 0 && hand2 == 2)   // Rock beats Scissors
    || (hand1 == 1 && hand2 == 0) // Paper beats Rock
    || (hand1 == 2 && hand2 == 1) // Scissors beats Paper
}

fn save_game(env: &Env, session_id: u32, game: &Game) {
    let key = DataKey::Game(session_id);
    env.storage().temporary().set(&key, game);
    env.storage()
        .temporary()
        .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct CtmContract;

#[contractimpl]
impl CtmContract {
    // ------------------------------------------------------------------ init

    /// Initialize the contract with admin + Game Hub address.
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
    }

    // ------------------------------------------------------------ start_game

    /// Start a new Gawi Bawi Bo session.
    ///
    /// Creates a session in the Game Hub and locks both players' points.
    /// Requires multi-sig auth from both players.
    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Cannot play against yourself: Player 1 and Player 2 must be different addresses");
        }

        // Both players authorize their point commitment
        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        // Register with Game Hub
        let hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");
        let hub = GameHubClient::new(&env, &hub_addr);
        hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let game = Game {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            phase: 1,
            p1_commit: None,
            p2_commit: None,
            p1_left: None,
            p1_right: None,
            p2_left: None,
            p2_right: None,
            p1_choice_commit: None,
            p2_choice_commit: None,
            p1_kept: None,
            p2_kept: None,
            winner: None,
        };

        save_game(&env, session_id, &game);
        Ok(())
    }

    // ---------------------------------------------------------- commit_hands

    /// **Phase 1** – Commit two hands (hidden).
    ///
    /// `hands_hash = keccak256(left_hand_u8 || right_hand_u8 || salt_32bytes)`
    pub fn commit_hands(
        env: Env,
        session_id: u32,
        player: Address,
        hands_hash: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.phase != 1 {
            return Err(Error::WrongPhase);
        }

        if player == game.player1 {
            if game.p1_commit.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.p1_commit = Some(hands_hash);
        } else if player == game.player2 {
            if game.p2_commit.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.p2_commit = Some(hands_hash);
        } else {
            return Err(Error::NotPlayer);
        }

        // Auto-advance when both have committed
        if game.p1_commit.is_some() && game.p2_commit.is_some() {
            game.phase = 2;
        }

        save_game(&env, session_id, &game);
        Ok(())
    }

    // ---------------------------------------------------------- reveal_hands

    /// **Phase 2** – Reveal hands and verify against the commitment hash.
    ///
    /// The contract recomputes `keccak256(left || right || salt)` and checks
    /// it matches the stored commitment.  Both hands must be valid (0-2) and
    /// different from each other.
    pub fn reveal_hands(
        env: Env,
        session_id: u32,
        player: Address,
        left_hand: u32,
        right_hand: u32,
        salt: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.phase != 2 {
            return Err(Error::WrongPhase);
        }
        if left_hand > 2 || right_hand > 2 {
            return Err(Error::InvalidHand);
        }
        if left_hand == right_hand {
            return Err(Error::HandsMustDiffer);
        }

        let computed = hash_hands(&env, left_hand, right_hand, &salt);

        if player == game.player1 {
            if game.p1_left.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            let commit = game.p1_commit.clone().unwrap();
            if computed != commit {
                return Err(Error::HashMismatch);
            }
            game.p1_left = Some(left_hand);
            game.p1_right = Some(right_hand);
        } else if player == game.player2 {
            if game.p2_left.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            let commit = game.p2_commit.clone().unwrap();
            if computed != commit {
                return Err(Error::HashMismatch);
            }
            game.p2_left = Some(left_hand);
            game.p2_right = Some(right_hand);
        } else {
            return Err(Error::NotPlayer);
        }

        // Auto-advance when both have revealed
        if game.p1_left.is_some() && game.p2_left.is_some() {
            game.phase = 3;
        }

        save_game(&env, session_id, &game);
        Ok(())
    }

    // --------------------------------------------------------- commit_choice

    /// **Phase 3** – Commit which hand to keep (hidden).
    ///
    /// `choice_hash = keccak256(choice_index_u8 || salt_32bytes)`
    /// where `choice_index` is 0 for the left hand, 1 for the right.
    pub fn commit_choice(
        env: Env,
        session_id: u32,
        player: Address,
        choice_hash: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.phase != 3 {
            return Err(Error::WrongPhase);
        }

        if player == game.player1 {
            if game.p1_choice_commit.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.p1_choice_commit = Some(choice_hash);
        } else if player == game.player2 {
            if game.p2_choice_commit.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.p2_choice_commit = Some(choice_hash);
        } else {
            return Err(Error::NotPlayer);
        }

        if game.p1_choice_commit.is_some() && game.p2_choice_commit.is_some() {
            game.phase = 4;
        }

        save_game(&env, session_id, &game);
        Ok(())
    }

    // --------------------------------------------------------- reveal_choice

    /// **Phase 4** – Reveal which hand you kept.
    ///
    /// The contract verifies the hash, looks up the actual hand value, and —
    /// once both players have revealed — resolves the RPS duel and reports to
    /// the Game Hub.
    pub fn reveal_choice(
        env: Env,
        session_id: u32,
        player: Address,
        choice_index: u32,
        salt: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.phase != 4 {
            return Err(Error::WrongPhase);
        }
        if choice_index > 1 {
            return Err(Error::InvalidChoice);
        }

        let computed = hash_choice(&env, choice_index, &salt);

        if player == game.player1 {
            if game.p1_kept.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            let commit = game.p1_choice_commit.clone().unwrap();
            if computed != commit {
                return Err(Error::HashMismatch);
            }
            let kept = if choice_index == 0 {
                game.p1_left.unwrap()
            } else {
                game.p1_right.unwrap()
            };
            game.p1_kept = Some(kept);
        } else if player == game.player2 {
            if game.p2_kept.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            let commit = game.p2_choice_commit.clone().unwrap();
            if computed != commit {
                return Err(Error::HashMismatch);
            }
            let kept = if choice_index == 0 {
                game.p2_left.unwrap()
            } else {
                game.p2_right.unwrap()
            };
            game.p2_kept = Some(kept);
        } else {
            return Err(Error::NotPlayer);
        }

        // ---- resolve when both revealed ----
        if game.p1_kept.is_some() && game.p2_kept.is_some() {
            let h1 = game.p1_kept.unwrap();
            let h2 = game.p2_kept.unwrap();

            // Draw → player 1 wins (tiebreaker, per studio convention)
            let player1_won = rps_beats(h1, h2) || h1 == h2;

            let winner = if player1_won {
                game.player1.clone()
            } else {
                game.player2.clone()
            };
            game.winner = Some(winner);
            game.phase = 5;

            // Report outcome to Game Hub
            let hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .expect("GameHub address not set");
            let hub = GameHubClient::new(&env, &hub_addr);
            hub.end_game(&session_id, &player1_won);
        }

        save_game(&env, session_id, &game);
        Ok(())
    }

    // -------------------------------------------------------------- get_game

    /// Read the current game state.
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    // ============================================================ Admin fns

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
