import { Client as CtmClient, type Game } from './bindings';
import {
  NETWORK_PASSPHRASE,
  RPC_URL,
  DEFAULT_METHOD_OPTIONS,
  DEFAULT_AUTH_TTL_MINUTES,
  MULTI_SIG_AUTH_TTL_MINUTES,
} from '@/utils/constants';
import { contract, TransactionBuilder, StrKey, xdr, Address, authorizeEntry } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';
import { keccak256 } from 'js-sha3';

type ClientOptions = contract.ClientOptions;

// ============================================================================
// Cryptographic Helpers  (must match Soroban contract preimage layout)
// ============================================================================

/**
 * Generate a cryptographically-random 32-byte salt.
 */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * keccak256(left_hand_u8 || right_hand_u8 || salt_32bytes)  – 34-byte preimage
 */
export function computeHandsHash(
  leftHand: number,
  rightHand: number,
  salt: Uint8Array,
): Buffer {
  const preimage = new Uint8Array(34);
  preimage[0] = leftHand;
  preimage[1] = rightHand;
  preimage.set(salt, 2);
  return Buffer.from(keccak256.array(preimage));
}

/**
 * keccak256(choice_index_u8 || salt_32bytes)  – 33-byte preimage
 */
export function computeChoiceHash(
  choiceIndex: number,
  salt: Uint8Array,
): Buffer {
  const preimage = new Uint8Array(33);
  preimage[0] = choiceIndex;
  preimage.set(salt, 1);
  return Buffer.from(keccak256.array(preimage));
}

// ============================================================================
// LocalStorage helpers  – persist salts so reveals survive page refreshes
// ============================================================================

const LS_PREFIX = 'gwb-zk-';

export function saveHandsData(
  sessionId: number,
  playerAddress: string,
  left: number,
  right: number,
  salt: Uint8Array,
) {
  localStorage.setItem(
    `${LS_PREFIX}hands-${sessionId}-${playerAddress}`,
    JSON.stringify({ left, right, salt: Array.from(salt) }),
  );
}

export function loadHandsData(
  sessionId: number,
  playerAddress: string,
): { left: number; right: number; salt: Uint8Array } | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}hands-${sessionId}-${playerAddress}`);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { left: d.left, right: d.right, salt: new Uint8Array(d.salt) };
  } catch {
    return null;
  }
}

export function saveChoiceData(
  sessionId: number,
  playerAddress: string,
  choice: number,
  salt: Uint8Array,
) {
  localStorage.setItem(
    `${LS_PREFIX}choice-${sessionId}-${playerAddress}`,
    JSON.stringify({ choice, salt: Array.from(salt) }),
  );
}

export function loadChoiceData(
  sessionId: number,
  playerAddress: string,
): { choice: number; salt: Uint8Array } | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}choice-${sessionId}-${playerAddress}`);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { choice: d.choice, salt: new Uint8Array(d.salt) };
  } catch {
    return null;
  }
}

export function clearGameData(sessionId: number, playerAddress: string) {
  localStorage.removeItem(`${LS_PREFIX}hands-${sessionId}-${playerAddress}`);
  localStorage.removeItem(`${LS_PREFIX}choice-${sessionId}-${playerAddress}`);
}

// ============================================================================
// CtmService
// ============================================================================

export class CtmService {
  private baseClient: CtmClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new CtmClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  ): CtmClient {
    const options: ClientOptions = {
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    };
    return new CtmClient(options);
  }

  // ------------------------------------------------------------------
  // Read-only
  // ------------------------------------------------------------------

  async getGame(sessionId: number): Promise<Game | null> {
    try {
      const tx = await this.baseClient.get_game({ session_id: sessionId });
      const result = await tx.simulate();
      if (result.result.isOk()) return result.result.unwrap();
      console.log('[getGame] Game not found for session:', sessionId);
      return null;
    } catch (err) {
      console.log('[getGame] Error querying game:', err);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Start game (multi-sig)
  // ------------------------------------------------------------------

  async startGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ) {
    const client = this.createSigningClient(player1, signer);
    const tx = await client.start_game(
      { session_id: sessionId, player1, player2, player1_points: player1Points, player2_points: player2Points },
      DEFAULT_METHOD_OPTIONS,
    );
    const validUntil = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
    return sentTx.result;
  }

  // ------------------------------------------------------------------
  // Multi-sig helpers (prepare → import → finalize)
  // ------------------------------------------------------------------

  async prepareStartGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    player1Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ): Promise<string> {
    const buildClient = new CtmClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });
    const tx = await buildClient.start_game(
      { session_id: sessionId, player1, player2, player1_points: player1Points, player2_points: player2Points },
      DEFAULT_METHOD_OPTIONS,
    );

    if (!tx.simulationData?.result?.auth) throw new Error('No auth entries found in simulation');
    const authEntries = tx.simulationData.result.auth;
    let player1AuthEntry = null;
    for (let i = 0; i < authEntries.length; i++) {
      try {
        const addr = Address.fromScAddress(authEntries[i].credentials().address().address()).toString();
        if (addr === player1) { player1AuthEntry = authEntries[i]; break; }
      } catch { continue; }
    }
    if (!player1AuthEntry) throw new Error(`No auth entry for Player 1 (${player1})`);

    const validUntil = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    if (!player1Signer.signAuthEntry) throw new Error('signAuthEntry not available');

    const signedAuthEntry = await authorizeEntry(
      player1AuthEntry,
      async (preimage) => {
        const sig = await player1Signer.signAuthEntry!(preimage.toXDR('base64'), {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: player1,
        });
        if (sig.error) throw new Error(`Failed to sign auth entry: ${sig.error.message}`);
        return Buffer.from(sig.signedAuthEntry, 'base64');
      },
      validUntil,
      NETWORK_PASSPHRASE,
    );
    return signedAuthEntry.toXDR('base64');
  }

  parseAuthEntry(authEntryXdr: string) {
    const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
    const creds = authEntry.credentials().address();
    const player1 = Address.fromScAddress(creds.address()).toString();
    const rootFn = authEntry.rootInvocation().function().contractFn();
    const functionName = rootFn.functionName().toString();
    if (functionName !== 'start_game') throw new Error(`Unexpected function: ${functionName}`);
    const args = rootFn.args();
    if (args.length !== 2) throw new Error(`Expected 2 args, got ${args.length}`);
    return {
      sessionId: args[0].u32(),
      player1,
      player1Points: args[1].i128().lo().toBigInt(),
      functionName,
    };
  }

  async importAndSignAuthEntry(
    player1SignedAuthEntryXdr: string,
    player2Address: string,
    player2Points: bigint,
    player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ): Promise<string> {
    const params = this.parseAuthEntry(player1SignedAuthEntryXdr);
    if (player2Address === params.player1) throw new Error('Cannot play against yourself.');

    const buildClient = new CtmClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2Address,
    });
    const tx = await buildClient.start_game(
      {
        session_id: params.sessionId,
        player1: params.player1,
        player2: player2Address,
        player1_points: params.player1Points,
        player2_points: player2Points,
      },
      DEFAULT_METHOD_OPTIONS,
    );

    const validUntil = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    const txWithAuth = await injectSignedAuthEntry(
      tx,
      player1SignedAuthEntryXdr,
      player2Address,
      player2Signer,
      validUntil,
    );

    const p2Client = this.createSigningClient(player2Address, player2Signer);
    const p2Tx = p2Client.txFromXDR(txWithAuth.toXDR());
    const needsSigning = await p2Tx.needsNonInvokerSigningBy();
    if (needsSigning.includes(player2Address)) {
      await p2Tx.signAuthEntries({ expiration: validUntil });
    }
    return p2Tx.toXDR();
  }

  async finalizeStartGame(
    txXdr: string,
    signerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = client.txFromXDR(txXdr);
    await tx.simulate();
    const validUntil = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
    return sentTx.result;
  }

  parseTransactionXDR(txXdr: string) {
    const transaction = TransactionBuilder.fromXDR(txXdr, NETWORK_PASSPHRASE);
    const transactionSource = 'source' in transaction ? transaction.source : '';
    const op = transaction.operations[0];
    if (!op || op.type !== 'invokeHostFunction') throw new Error('Not a contract invocation');
    const invokeArgs = op.func.invokeContract();
    const functionName = invokeArgs.functionName().toString();
    if (functionName !== 'start_game') throw new Error(`Unexpected function: ${functionName}`);
    const args = invokeArgs.args();
    if (args.length !== 5) throw new Error(`Expected 5 args, got ${args.length}`);
    return {
      sessionId: args[0].u32(),
      player1: StrKey.encodeEd25519PublicKey(args[1].address().accountId().ed25519()),
      player2: StrKey.encodeEd25519PublicKey(args[2].address().accountId().ed25519()),
      player1Points: args[3].i128().lo().toBigInt(),
      player2Points: args[4].i128().lo().toBigInt(),
      transactionSource,
      functionName,
    };
  }

  // ------------------------------------------------------------------
  // Game actions
  // ------------------------------------------------------------------

  private async sendGameAction(
    method: (client: CtmClient) => Promise<any>,
    playerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ) {
    const client = this.createSigningClient(playerAddress, signer);
    const tx = await method(client);
    const validUntil = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    try {
      const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntil);
      if (sentTx.getTransactionResponse?.status === 'FAILED') {
        throw new Error(`Transaction failed: ${this.extractError(sentTx.getTransactionResponse)}`);
      }
      return sentTx.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Transaction failed – check game state and try again');
      }
      throw err;
    }
  }

  async commitHands(
    sessionId: number,
    playerAddress: string,
    handsHash: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ) {
    return this.sendGameAction(
      (c) => c.commit_hands({ session_id: sessionId, player: playerAddress, hands_hash: handsHash }, DEFAULT_METHOD_OPTIONS),
      playerAddress,
      signer,
      authTtlMinutes,
    );
  }

  async revealHands(
    sessionId: number,
    playerAddress: string,
    leftHand: number,
    rightHand: number,
    salt: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ) {
    return this.sendGameAction(
      (c) =>
        c.reveal_hands(
          { session_id: sessionId, player: playerAddress, left_hand: leftHand, right_hand: rightHand, salt },
          DEFAULT_METHOD_OPTIONS,
        ),
      playerAddress,
      signer,
      authTtlMinutes,
    );
  }

  async commitChoice(
    sessionId: number,
    playerAddress: string,
    choiceHash: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ) {
    return this.sendGameAction(
      (c) => c.commit_choice({ session_id: sessionId, player: playerAddress, choice_hash: choiceHash }, DEFAULT_METHOD_OPTIONS),
      playerAddress,
      signer,
      authTtlMinutes,
    );
  }

  async revealChoice(
    sessionId: number,
    playerAddress: string,
    choiceIndex: number,
    salt: Buffer,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number,
  ) {
    return this.sendGameAction(
      (c) =>
        c.reveal_choice(
          { session_id: sessionId, player: playerAddress, choice_index: choiceIndex, salt },
          DEFAULT_METHOD_OPTIONS,
        ),
      playerAddress,
      signer,
      authTtlMinutes,
    );
  }

  // ------------------------------------------------------------------
  // Error extraction
  // ------------------------------------------------------------------

  private extractError(resp: any): string {
    try {
      console.error('Transaction response:', JSON.stringify(resp, null, 2));
      return resp?.status ? `Transaction ${resp.status}` : 'Unknown error';
    } catch {
      return 'Transaction failed with unknown error';
    }
  }
}
