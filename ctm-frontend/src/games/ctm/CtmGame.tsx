import { useState, useEffect, useRef, useCallback } from 'react';
import {
  CtmService,
  generateSalt,
  computeHandsHash,
  computeChoiceHash,
  saveHandsData,
  loadHandsData,
  saveChoiceData,
  loadChoiceData,
  clearGameData,
} from './ctmService';
import { useWallet } from '@/hooks/useWallet';
import { CTM_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import { Buffer } from 'buffer';
import type { Game } from './bindings';

// ============================================================================
// Constants
// ============================================================================

const HAND_EMOJI = ['🪨', '✋', '✌️'] as const;
const HAND_NAME = ['Rock', 'Paper', 'Scissors'] as const;

const ctmService = new CtmService(CTM_CONTRACT);

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let v = 0;
    const buf = new Uint32Array(1);
    while (v === 0) { crypto.getRandomValues(buf); v = buf[0]; }
    return v;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

// ============================================================================
// Types
// ============================================================================

type UIPhase =
  | 'create'
  | 'commit_hands'
  | 'waiting_commits'
  | 'reveal_hands'
  | 'waiting_reveals'
  | 'commit_choice'
  | 'waiting_choices'
  | 'reveal_choice'
  | 'waiting_final'
  | 'complete';

interface CtmGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function rpsResult(h1: number, h2: number): 'p1' | 'p2' | 'draw' {
  if (h1 === h2) return 'draw';
  if ((h1 === 0 && h2 === 2) || (h1 === 1 && h2 === 0) || (h1 === 2 && h2 === 1)) return 'p1';
  return 'p2';
}

function deriveUIPhase(game: Game | null, userAddress: string): UIPhase {
  if (!game) return 'create';
  const isP1 = game.player1 === userAddress;
  switch (game.phase) {
    case 1: return (isP1 ? game.p1_commit : game.p2_commit) != null ? 'waiting_commits' : 'commit_hands';
    case 2: return (isP1 ? game.p1_left : game.p2_left) != null ? 'waiting_reveals' : 'reveal_hands';
    case 3: return (isP1 ? game.p1_choice_commit : game.p2_choice_commit) != null ? 'waiting_choices' : 'commit_choice';
    case 4: return (isP1 ? game.p1_kept : game.p2_kept) != null ? 'waiting_final' : 'reveal_choice';
    case 5: return 'complete';
    default: return 'create';
  }
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ============================================================================
// Component
// ============================================================================

export function CtmGame({
  userAddress,
  availablePoints,
  initialXDR,
  initialSessionId,
  onStandingsRefresh,
  onGameComplete,
}: CtmGameProps) {
  const DEFAULT_POINTS = '0.1';
  const POINTS_DECIMALS = 7;
  const { getContractSigner, walletType } = useWallet();

  // --- state -----------------------------------------------------------------
  const [sessionId, setSessionId] = useState(() => createRandomSessionId());
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [gamePhase, setGamePhase] = useState<'create' | 'playing'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [xdrParsing, setXdrParsing] = useState(false);
  const [xdrParseError, setXdrParseError] = useState<string | null>(null);
  const [xdrParseSuccess, setXdrParseSuccess] = useState(false);

  // Game-play state
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [selectedRight, setSelectedRight] = useState<number | null>(null);
  const [selectedKeep, setSelectedKeep] = useState<number | null>(null);

  const actionLock = useRef(false);
  const isBusy = loading || quickstartLoading;
  const quickstartAvailable =
    walletType === 'dev' &&
    DevWalletService.isDevModeAvailable() &&
    DevWalletService.isPlayerAvailable(1) &&
    DevWalletService.isPlayerAvailable(2);

  // Derived UI phase
  const uiPhase: UIPhase =
    gamePhase === 'create' ? 'create' : deriveUIPhase(gameState, userAddress);

  // --- helpers ---------------------------------------------------------------

  useEffect(() => { setPlayer1Address(userAddress); }, [userAddress]);

  const parsePoints = (v: string): bigint | null => {
    try {
      const c = v.replace(/[^\d.]/g, '');
      if (!c || c === '.') return null;
      const [w = '0', f = ''] = c.split('.');
      return BigInt(w + f.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS));
    } catch { return null; }
  };

  const runAction = async (fn: () => Promise<void>) => {
    if (actionLock.current || isBusy) return;
    actionLock.current = true;
    try { await fn(); } finally { actionLock.current = false; }
  };

  const loadGameState = useCallback(async () => {
    try {
      const game = await ctmService.getGame(sessionId);
      setGameState(game);
    } catch { setGameState(null); }
  }, [sessionId]);

  // Poll for state changes while playing
  useEffect(() => {
    if (gamePhase !== 'playing') return;
    loadGameState();
    const id = setInterval(loadGameState, 5000);
    return () => clearInterval(id);
  }, [sessionId, gamePhase, loadGameState]);

  // Refresh standings when game completes
  useEffect(() => {
    if (uiPhase === 'complete' && gameState?.winner) onStandingsRefresh();
  }, [uiPhase, gameState?.winner]);

  // --- deep-linking ----------------------------------------------------------
  useEffect(() => {
    if (initialXDR) {
      try {
        const parsed = ctmService.parseAuthEntry(initialXDR);
        ctmService.getGame(parsed.sessionId).then((game) => {
          if (game) {
            setGameState(game); setGamePhase('playing'); setSessionId(parsed.sessionId);
          } else {
            setCreateMode('import');
            setImportAuthEntryXDR(initialXDR);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 1e7).toString());
          }
        }).catch(() => {
          setCreateMode('import'); setImportAuthEntryXDR(initialXDR);
        });
      } catch { setCreateMode('import'); setImportAuthEntryXDR(initialXDR); }
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    const urlSid = params.get('session-id');
    if (auth) {
      try {
        const p = ctmService.parseAuthEntry(auth);
        ctmService.getGame(p.sessionId).then((g) => {
          if (g) { setGameState(g); setGamePhase('playing'); setSessionId(p.sessionId); }
          else { setCreateMode('import'); setImportAuthEntryXDR(auth); setImportSessionId(p.sessionId.toString()); setImportPlayer1(p.player1); setImportPlayer1Points((Number(p.player1Points)/1e7).toString()); }
        }).catch(() => { setCreateMode('import'); setImportAuthEntryXDR(auth); });
      } catch { setCreateMode('import'); setImportAuthEntryXDR(auth); }
    } else if (urlSid) { setCreateMode('load'); setLoadSessionId(urlSid); }
    else if (initialSessionId != null) { setCreateMode('load'); setLoadSessionId(initialSessionId.toString()); }
  }, [initialXDR, initialSessionId]);

  // Auto-parse auth entry XDR
  useEffect(() => {
    if (createMode !== 'import' || !importAuthEntryXDR.trim()) {
      if (!importAuthEntryXDR.trim()) { setXdrParsing(false); setXdrParseError(null); setXdrParseSuccess(false); setImportSessionId(''); setImportPlayer1(''); setImportPlayer1Points(''); }
      return;
    }
    const t = setTimeout(async () => {
      setXdrParsing(true); setXdrParseError(null); setXdrParseSuccess(false);
      try {
        const p = ctmService.parseAuthEntry(importAuthEntryXDR.trim());
        if (p.player1 === userAddress) throw new Error('You cannot play against yourself.');
        setImportSessionId(p.sessionId.toString()); setImportPlayer1(p.player1);
        setImportPlayer1Points((Number(p.player1Points) / 1e7).toString()); setXdrParseSuccess(true);
      } catch (e) {
        setXdrParseError(e instanceof Error ? e.message : 'Invalid auth entry'); setImportSessionId(''); setImportPlayer1(''); setImportPlayer1Points('');
      } finally { setXdrParsing(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [importAuthEntryXDR, createMode, userAddress]);

  // --- actions ---------------------------------------------------------------

  const resetToCreate = () => {
    if (gameState?.winner) onGameComplete();
    actionLock.current = false;
    setGamePhase('create'); setSessionId(createRandomSessionId()); setGameState(null);
    setLoading(false); setQuickstartLoading(false); setError(null); setSuccess(null);
    setCreateMode('create'); setExportedAuthEntryXDR(null);
    setImportAuthEntryXDR(''); setImportSessionId(''); setImportPlayer1('');
    setImportPlayer1Points(''); setImportPlayer2Points(DEFAULT_POINTS);
    setLoadSessionId(''); setAuthEntryCopied(false); setShareUrlCopied(false);
    setXdrParsing(false); setXdrParseError(null); setXdrParseSuccess(false);
    setPlayer1Address(userAddress); setPlayer1Points(DEFAULT_POINTS);
    setSelectedLeft(null); setSelectedRight(null); setSelectedKeep(null);
  };

  const handlePrepare = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setError(null); setSuccess(null);
        const pts = parsePoints(player1Points);
        if (!pts || pts <= 0n) throw new Error('Enter valid points');
        const signer = getContractSigner();
        const placeholder = await getFundedSimulationSourceAddress([player1Address, userAddress]);
        const xdr = await ctmService.prepareStartGame(sessionId, player1Address, placeholder, pts, pts, signer);
        setExportedAuthEntryXDR(xdr);
        setSuccess('Auth entry signed! Send to Player 2.');
        // Poll for game creation
        const poll = setInterval(async () => {
          const g = await ctmService.getGame(sessionId);
          if (g) { clearInterval(poll); setGameState(g); setGamePhase('playing'); setExportedAuthEntryXDR(null); setSuccess('Game created!'); onStandingsRefresh(); setTimeout(() => setSuccess(null), 2000); }
        }, 3000);
        setTimeout(() => clearInterval(poll), 300_000);
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed to prepare'); } finally { setLoading(false); }
    });
  };

  const handleImport = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setError(null); setSuccess(null);
        if (!importAuthEntryXDR.trim()) throw new Error('Enter auth entry XDR');
        const p2pts = parsePoints(importPlayer2Points);
        if (!p2pts || p2pts <= 0n) throw new Error('Invalid points');
        const params = ctmService.parseAuthEntry(importAuthEntryXDR.trim());
        if (params.player1 === userAddress) throw new Error('Cannot play against yourself');
        const signer = getContractSigner();
        const fullXdr = await ctmService.importAndSignAuthEntry(importAuthEntryXDR.trim(), userAddress, p2pts, signer);
        await ctmService.finalizeStartGame(fullXdr, userAddress, signer);
        setSessionId(params.sessionId); setGamePhase('playing');
        await loadGameState(); onStandingsRefresh();
        setSuccess('Game created!'); setTimeout(() => setSuccess(null), 2000);
      } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); } finally { setLoading(false); }
    });
  };

  const handleLoad = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setError(null); setSuccess(null);
        const sid = parseInt(loadSessionId.trim());
        if (isNaN(sid) || sid <= 0) throw new Error('Invalid session ID');
        const game = await ctmService.getGame(sid);
        if (!game) throw new Error('Game not found');
        if (game.player1 !== userAddress && game.player2 !== userAddress) throw new Error('You are not in this game');
        setSessionId(sid); setGameState(game); setGamePhase('playing');
        setSuccess('Game loaded!'); setTimeout(() => setSuccess(null), 2000);
      } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); } finally { setLoading(false); }
    });
  };

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true); setError(null); setSuccess(null);
        if (walletType !== 'dev') throw new Error('Quickstart needs dev wallets');
        const pts = parsePoints(player1Points);
        if (!pts || pts <= 0n) throw new Error('Enter valid points');
        const orig = devWalletService.getCurrentPlayer();
        let p1Addr = '', p2Addr = '';
        let p1Sign: any, p2Sign: any;
        try {
          await devWalletService.initPlayer(1); p1Addr = devWalletService.getPublicKey(); p1Sign = devWalletService.getSigner();
          await devWalletService.initPlayer(2); p2Addr = devWalletService.getPublicKey(); p2Sign = devWalletService.getSigner();
        } finally { if (orig) await devWalletService.initPlayer(orig); }
        if (p1Addr === p2Addr) throw new Error('Need two different dev wallets');
        const sid = createRandomSessionId(); setSessionId(sid); setPlayer1Address(p1Addr);

        // 1) Create game
        const placeholder = await getFundedSimulationSourceAddress([p1Addr, p2Addr]);
        const authXdr = await ctmService.prepareStartGame(sid, p1Addr, placeholder, pts, pts, p1Sign);
        const fullXdr = await ctmService.importAndSignAuthEntry(authXdr, p2Addr, pts, p2Sign);
        await ctmService.finalizeStartGame(fullXdr, p2Addr, p2Sign);

        // 2) Commit hands: P1=Rock+Paper, P2=Scissors+Rock
        const s1 = generateSalt(), s2 = generateSalt();
        await ctmService.commitHands(sid, p1Addr, computeHandsHash(0, 1, s1), p1Sign);
        await ctmService.commitHands(sid, p2Addr, computeHandsHash(2, 0, s2), p2Sign);

        // 3) Reveal hands
        await ctmService.revealHands(sid, p1Addr, 0, 1, Buffer.from(s1), p1Sign);
        await ctmService.revealHands(sid, p2Addr, 2, 0, Buffer.from(s2), p2Sign);

        // 4) Commit choice: P1 keeps left(Rock), P2 keeps left(Scissors)
        const cs1 = generateSalt(), cs2 = generateSalt();
        await ctmService.commitChoice(sid, p1Addr, computeChoiceHash(0, cs1), p1Sign);
        await ctmService.commitChoice(sid, p2Addr, computeChoiceHash(0, cs2), p2Sign);

        // 5) Reveal choice
        await ctmService.revealChoice(sid, p1Addr, 0, Buffer.from(cs1), p1Sign);
        await ctmService.revealChoice(sid, p2Addr, 0, Buffer.from(cs2), p2Sign);

        const game = await ctmService.getGame(sid);
        setGameState(game); setGamePhase('playing'); onStandingsRefresh();
        setSuccess('Quickstart complete! Rock 🪨 vs Scissors ✌️ → Player 1 wins!');
        setTimeout(() => setSuccess(null), 4000);
      } catch (e) { setError(e instanceof Error ? e.message : 'Quickstart failed'); } finally { setQuickstartLoading(false); }
    });
  };

  // --- Game action handlers --------------------------------------------------

  const handleCommitHands = async () => {
    if (selectedLeft === null || selectedRight === null) { setError('Select both hands'); return; }
    if (selectedLeft === selectedRight) { setError('Hands must be different figures'); return; }
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const salt = generateSalt();
        const hash = computeHandsHash(selectedLeft!, selectedRight!, salt);
        saveHandsData(sessionId, userAddress, selectedLeft!, selectedRight!, salt);
        const signer = getContractSigner();
        await ctmService.commitHands(sessionId, userAddress, hash, signer);
        setSuccess('Hands committed! Waiting for opponent…');
        await loadGameState();
      } catch (e) { setError(e instanceof Error ? e.message : 'Commit failed'); } finally { setLoading(false); }
    });
  };

  const handleRevealHands = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const data = loadHandsData(sessionId, userAddress);
        if (!data) throw new Error('No saved hands data – cannot reveal. Did you clear browser data?');
        const signer = getContractSigner();
        await ctmService.revealHands(sessionId, userAddress, data.left, data.right, Buffer.from(data.salt), signer);
        setSuccess('Hands revealed!');
        await loadGameState();
      } catch (e) { setError(e instanceof Error ? e.message : 'Reveal failed'); } finally { setLoading(false); }
    });
  };

  const handleCommitChoice = async () => {
    if (selectedKeep === null) { setError('Select which hand to keep'); return; }
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const salt = generateSalt();
        const hash = computeChoiceHash(selectedKeep!, salt);
        saveChoiceData(sessionId, userAddress, selectedKeep!, salt);
        const signer = getContractSigner();
        await ctmService.commitChoice(sessionId, userAddress, hash, signer);
        setSuccess('Choice committed! Waiting for opponent…');
        await loadGameState();
      } catch (e) { setError(e instanceof Error ? e.message : 'Commit choice failed'); } finally { setLoading(false); }
    });
  };

  const handleRevealChoice = async () => {
    await runAction(async () => {
      try {
        setLoading(true); setError(null);
        const data = loadChoiceData(sessionId, userAddress);
        if (!data) throw new Error('No saved choice data – cannot reveal.');
        const signer = getContractSigner();
        await ctmService.revealChoice(sessionId, userAddress, data.choice, Buffer.from(data.salt), signer);
        setSuccess('Choice revealed!');
        await loadGameState();
        clearGameData(sessionId, userAddress);
      } catch (e) { setError(e instanceof Error ? e.message : 'Reveal choice failed'); } finally { setLoading(false); }
    });
  };

  // --- clipboard helpers -----------------------------------------------------
  const copyAuth = async () => { if (exportedAuthEntryXDR) { await navigator.clipboard.writeText(exportedAuthEntryXDR); setAuthEntryCopied(true); setTimeout(() => setAuthEntryCopied(false), 2000); } };
  const copyShareUrl = async () => {
    if (exportedAuthEntryXDR) {
      const url = `${window.location.origin}${window.location.pathname}?game=ctm&auth=${exportedAuthEntryXDR}`;
      await navigator.clipboard.writeText(url); setShareUrlCopied(true); setTimeout(() => setShareUrlCopied(false), 2000);
    }
  };

  // --- sub-components --------------------------------------------------------

  const HandButton = ({ hand, selected, onSelect, disabled }: { hand: number; selected: boolean; onSelect: () => void; disabled?: boolean }) => (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`p-4 rounded-xl border-2 font-bold text-2xl transition-all ${
        selected
          ? 'border-purple-500 bg-gradient-to-br from-purple-500 to-pink-500 text-white scale-110 shadow-2xl'
          : 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-lg hover:scale-105 disabled:opacity-50'
      }`}
    >
      {HAND_EMOJI[hand]}
      <div className="text-xs mt-1">{HAND_NAME[hand]}</div>
    </button>
  );

  const HandDisplay = ({ hand, label, highlight }: { hand: number | undefined | null; label: string; highlight?: boolean }) => (
    <div className={`p-3 rounded-xl border-2 text-center ${highlight ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'}`}>
      <div className="text-xs font-bold text-gray-500 mb-1">{label}</div>
      <div className="text-3xl">{hand != null ? HAND_EMOJI[hand] : '❓'}</div>
      <div className="text-xs font-semibold mt-1">{hand != null ? HAND_NAME[hand] : 'Hidden'}</div>
    </div>
  );

  const PlayerCard = ({ label, address, points, isMe, statusEl }: { label: string; address: string; points: bigint; isMe: boolean; statusEl: React.ReactNode }) => (
    <div className={`p-4 rounded-xl border-2 ${isMe ? 'border-purple-400 bg-gradient-to-br from-purple-50 to-pink-50 shadow-lg' : 'border-gray-200 bg-white'}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-1">{label}</div>
      <div className="font-mono text-sm font-semibold mb-1 text-gray-800">{shortAddr(address)}</div>
      <div className="text-xs font-semibold text-gray-600">Points: {(Number(points) / 1e7).toFixed(2)}</div>
      <div className="mt-2">{statusEl}</div>
    </div>
  );

  const StatusBadge = ({ done, text }: { done: boolean; text?: string }) => (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${done ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-white shadow-md' : 'bg-gray-200 text-gray-600'}`}>
      {done ? '✓ Done' : text || 'Waiting…'}
    </span>
  );

  const WaitingBanner = ({ msg }: { msg: string }) => (
    <div className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl animate-pulse">
      <p className="text-sm font-semibold text-blue-700">⏳ {msg}</p>
    </div>
  );

  // --- phase status for player cards -----------------------------------------

  const p1Status = (g: Game) => {
    if (g.phase >= 5) return <StatusBadge done text={g.winner === g.player1 ? '🏆 Winner!' : 'Lost'} />;
    if (g.phase >= 4) return <StatusBadge done={g.p1_kept != null} />;
    if (g.phase >= 3) return <StatusBadge done={g.p1_choice_commit != null} />;
    if (g.phase >= 2) return <StatusBadge done={g.p1_left != null} />;
    return <StatusBadge done={g.p1_commit != null} />;
  };
  const p2Status = (g: Game) => {
    if (g.phase >= 5) return <StatusBadge done text={g.winner === g.player2 ? '🏆 Winner!' : 'Lost'} />;
    if (g.phase >= 4) return <StatusBadge done={g.p2_kept != null} />;
    if (g.phase >= 3) return <StatusBadge done={g.p2_choice_commit != null} />;
    if (g.phase >= 2) return <StatusBadge done={g.p2_left != null} />;
    return <StatusBadge done={g.p2_commit != null} />;
  };

  const phaseLabel = (phase: number) => ['', '🔒 Commit Hands', '👁 Reveal Hands', '🧠 Choose Hand', '🎯 Reveal Choice', '🏆 Complete'][phase] ?? '';

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-purple-200">
      {/* Header */}
      <div className="flex items-center mb-6">
        <div>
          <h2 className="text-3xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 bg-clip-text text-transparent">
            Gawi Bawi Bo ZK 🪨✋✌️
          </h2>
          <p className="text-sm text-gray-700 font-semibold mt-1">Korean Double Rock-Paper-Scissors with ZK commitments</p>
          <p className="text-xs text-gray-500 font-mono mt-1">Session: {sessionId} {gameState ? `• Phase ${gameState.phase}/5 ${phaseLabel(gameState.phase)}` : ''}</p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
          <p className="text-sm font-semibold text-green-700">{success}</p>
        </div>
      )}

      {/* ================================================================= */}
      {/* CREATE PHASE                                                       */}
      {/* ================================================================= */}
      {gamePhase === 'create' && (
        <div className="space-y-6">
          {/* Mode toggle */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 p-2 bg-gray-100 rounded-xl">
            {(['create', 'import', 'load'] as const).map((m) => (
              <button key={m} onClick={() => { setCreateMode(m); setExportedAuthEntryXDR(null); }}
                className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${createMode === m ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {m === 'create' ? 'Create & Export' : m === 'import' ? 'Import Auth Entry' : 'Load Game'}
              </button>
            ))}
          </div>

          {/* Quickstart */}
          <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-yellow-900">⚡ Quickstart (Dev)</p>
                <p className="text-xs font-semibold text-yellow-800">Creates game and plays full RPS demo with dev wallets.</p>
              </div>
              <button onClick={handleQuickStart} disabled={isBusy || !quickstartAvailable}
                className="px-4 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-md">
                {quickstartLoading ? 'Running…' : '⚡ Quickstart'}
              </button>
            </div>
          </div>

          {/* --- CREATE MODE --- */}
          {createMode === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Your Address (Player 1)</label>
                <input type="text" value={player1Address} onChange={(e) => setPlayer1Address(e.target.value.trim())} placeholder="G…"
                  className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium text-gray-700" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Your Points</label>
                <input type="text" value={player1Points} onChange={(e) => setPlayer1Points(e.target.value)} placeholder="0.1"
                  className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium" />
                <p className="text-xs font-semibold text-gray-600 mt-1">Available: {(Number(availablePoints) / 1e7).toFixed(2)} Points</p>
              </div>
              <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-xl">
                <p className="text-xs font-semibold text-blue-800">ℹ️ Player 2 will specify their own address and points when importing.</p>
              </div>
              {!exportedAuthEntryXDR ? (
                <button onClick={handlePrepare} disabled={isBusy}
                  className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg">
                  {loading ? 'Preparing…' : 'Prepare & Export Auth Entry'}
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                    <p className="text-xs font-bold uppercase tracking-wide text-green-700 mb-2">Auth Entry XDR</p>
                    <div className="bg-white p-3 rounded-lg border border-green-200 mb-3"><code className="text-xs font-mono text-gray-700 break-all">{exportedAuthEntryXDR}</code></div>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={copyAuth} className="py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold text-sm transition-all shadow-md">{authEntryCopied ? '✓ Copied!' : '📋 Copy'}</button>
                      <button onClick={copyShareUrl} className="py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold text-sm transition-all shadow-md">{shareUrlCopied ? '✓ Copied!' : '🔗 Share URL'}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --- IMPORT MODE --- */}
          {createMode === 'import' && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl space-y-3">
                <p className="text-sm font-semibold text-blue-800">📥 Import Auth Entry from Player 1</p>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-2">
                    Auth Entry XDR
                    {xdrParsing && <span className="text-blue-500 text-xs animate-pulse">Parsing…</span>}
                    {xdrParseSuccess && <span className="text-green-600 text-xs">✓ Parsed</span>}
                    {xdrParseError && <span className="text-red-600 text-xs">✗ Error</span>}
                  </label>
                  <textarea value={importAuthEntryXDR} onChange={(e) => setImportAuthEntryXDR(e.target.value)} rows={4} placeholder="Paste auth entry XDR…"
                    className={`w-full px-4 py-3 rounded-xl bg-white border-2 focus:outline-none focus:ring-4 text-xs font-mono resize-none ${xdrParseError ? 'border-red-300' : xdrParseSuccess ? 'border-green-300' : 'border-blue-200'}`} />
                  {xdrParseError && <p className="text-xs text-red-600 font-semibold mt-1">{xdrParseError}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-bold text-gray-500 mb-1">Session ID</label><input readOnly value={importSessionId} className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed" /></div>
                  <div><label className="block text-xs font-bold text-gray-500 mb-1">P1 Points</label><input readOnly value={importPlayer1Points} className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs text-gray-600 cursor-not-allowed" /></div>
                </div>
                <div><label className="block text-xs font-bold text-gray-500 mb-1">Player 1</label><input readOnly value={importPlayer1} className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-bold text-gray-500 mb-1">You (P2)</label><input readOnly value={userAddress} className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed" /></div>
                  <div><label className="block text-xs font-bold text-gray-700 mb-1">Your Points *</label><input type="text" value={importPlayer2Points} onChange={(e) => setImportPlayer2Points(e.target.value)} placeholder="0.1" className="w-full px-4 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 text-xs" /></div>
                </div>
              </div>
              <button onClick={handleImport} disabled={isBusy || !importAuthEntryXDR.trim()}
                className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-500 to-teal-500 hover:from-blue-600 hover:to-teal-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl">
                {loading ? 'Importing…' : 'Import & Sign'}
              </button>
            </div>
          )}

          {/* --- LOAD MODE --- */}
          {createMode === 'load' && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                <p className="text-sm font-semibold text-green-800 mb-2">🎮 Load Existing Game</p>
                <input type="text" value={loadSessionId} onChange={(e) => setLoadSessionId(e.target.value)} placeholder="Session ID"
                  className="w-full px-4 py-3 rounded-xl bg-white border-2 border-green-200 focus:outline-none focus:border-green-400 text-sm font-mono" />
              </div>
              <button onClick={handleLoad} disabled={isBusy || !loadSessionId.trim()}
                className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl">
                {loading ? 'Loading…' : '🎮 Load Game'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* PLAYING PHASE                                                      */}
      {/* ================================================================= */}
      {gamePhase === 'playing' && gameState && (
        <div className="space-y-6">
          {/* Player cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PlayerCard label="Player 1" address={gameState.player1} points={gameState.player1_points} isMe={gameState.player1 === userAddress} statusEl={p1Status(gameState)} />
            <PlayerCard label="Player 2" address={gameState.player2} points={gameState.player2_points} isMe={gameState.player2 === userAddress} statusEl={p2Status(gameState)} />
          </div>

          {/* ---- Phase 1: Commit Hands ---- */}
          {uiPhase === 'commit_hands' && (
            <div className="space-y-4">
              <h3 className="text-lg font-black text-gray-800">🔒 Phase 1: Choose Two Hands</h3>
              <p className="text-sm text-gray-600">Pick two <strong>different</strong> figures. They'll be hidden until both players commit.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-2 uppercase">Left Hand</p>
                  <div className="flex gap-3">
                    {[0, 1, 2].map((h) => <HandButton key={h} hand={h} selected={selectedLeft === h} onSelect={() => setSelectedLeft(h)} disabled={selectedRight === h} />)}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-2 uppercase">Right Hand</p>
                  <div className="flex gap-3">
                    {[0, 1, 2].map((h) => <HandButton key={h} hand={h} selected={selectedRight === h} onSelect={() => setSelectedRight(h)} disabled={selectedLeft === h} />)}
                  </div>
                </div>
              </div>
              <button onClick={handleCommitHands} disabled={isBusy || selectedLeft === null || selectedRight === null || selectedLeft === selectedRight}
                className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg">
                {loading ? 'Committing…' : `Commit: ${selectedLeft != null ? HAND_EMOJI[selectedLeft] : '?'} + ${selectedRight != null ? HAND_EMOJI[selectedRight] : '?'}`}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_commits' && <WaitingBanner msg="Your hands are committed. Waiting for opponent to commit…" />}

          {/* ---- Phase 2: Reveal Hands ---- */}
          {uiPhase === 'reveal_hands' && (
            <div className="space-y-4">
              <h3 className="text-lg font-black text-gray-800">👁 Phase 2: Reveal Your Hands</h3>
              <p className="text-sm text-gray-600">Both players committed. Click below to reveal your hands (verified on-chain against your hash).</p>
              <button onClick={handleRevealHands} disabled={isBusy}
                className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg">
                {loading ? 'Revealing…' : '👁 Reveal Hands'}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_reveals' && <WaitingBanner msg="Your hands are revealed. Waiting for opponent…" />}

          {/* ---- Phase 3: Commit Choice ---- */}
          {uiPhase === 'commit_choice' && (
            <div className="space-y-4">
              <h3 className="text-lg font-black text-gray-800">🧠 Phase 3: Strategic Removal</h3>
              <p className="text-sm text-gray-600">All hands are visible! Choose which of <strong>your</strong> hands to <strong>keep</strong> for the final duel.</p>

              {/* Show all 4 hands */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-bold text-purple-600 uppercase">Your Hands</p>
                  <div className="flex gap-3">
                    {[
                      { idx: 0, hand: gameState.player1 === userAddress ? gameState.p1_left : gameState.p2_left, label: 'Left' },
                      { idx: 1, hand: gameState.player1 === userAddress ? gameState.p1_right : gameState.p2_right, label: 'Right' },
                    ].map(({ idx, hand, label }) => (
                      <button key={idx} onClick={() => setSelectedKeep(idx)} disabled={hand == null}
                        className={`flex-1 p-4 rounded-xl border-2 text-center transition-all ${selectedKeep === idx ? 'border-yellow-500 bg-yellow-50 scale-105 shadow-lg' : 'border-gray-200 bg-white hover:border-yellow-300'}`}>
                        <div className="text-3xl">{hand != null ? HAND_EMOJI[hand] : '?'}</div>
                        <div className="text-xs font-bold mt-1">{label}</div>
                        {selectedKeep === idx && <div className="text-xs text-yellow-600 font-bold mt-1">KEEP ✓</div>}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-500 uppercase">Opponent's Hands</p>
                  <div className="flex gap-3">
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_left : gameState.p1_left} label="Left" />
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_right : gameState.p1_right} label="Right" />
                  </div>
                </div>
              </div>

              <button onClick={handleCommitChoice} disabled={isBusy || selectedKeep === null}
                className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg">
                {loading ? 'Committing…' : `Keep ${selectedKeep != null ? (selectedKeep === 0 ? 'Left' : 'Right') : '?'} Hand`}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_choices' && (
            <div className="space-y-4">
              <WaitingBanner msg="Your choice is committed. Waiting for opponent to choose…" />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-bold text-purple-600 uppercase">Your Hands</p>
                  <div className="flex gap-3">
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p1_left : gameState.p2_left} label="Left" />
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p1_right : gameState.p2_right} label="Right" />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-500 uppercase">Opponent's Hands</p>
                  <div className="flex gap-3">
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_left : gameState.p1_left} label="Left" />
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_right : gameState.p1_right} label="Right" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- Phase 4: Reveal Choice ---- */}
          {uiPhase === 'reveal_choice' && (
            <div className="space-y-4">
              <h3 className="text-lg font-black text-gray-800">🎯 Phase 4: Reveal Your Choice</h3>
              <p className="text-sm text-gray-600">Both players have chosen. Reveal your choice to determine the winner!</p>
              <button onClick={handleRevealChoice} disabled={isBusy}
                className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-pink-500 to-red-500 hover:from-pink-600 hover:to-red-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg">
                {loading ? 'Revealing…' : '🎯 Reveal Choice'}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_final' && <WaitingBanner msg="Your choice is revealed. Waiting for opponent's reveal…" />}

          {/* ---- Phase 5: Complete ---- */}
          {uiPhase === 'complete' && (
            <div className="space-y-6">
              <div className="p-10 bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 border-2 border-green-300 rounded-2xl text-center shadow-2xl">
                <div className="text-7xl mb-6">🏆</div>
                <h3 className="text-3xl font-black text-gray-900 mb-4">Game Complete!</h3>
                {gameState.p1_kept != null && gameState.p2_kept != null && (
                  <div className="space-y-4 mb-6">
                    <div className="text-4xl font-bold">
                      {HAND_EMOJI[gameState.p1_kept]} vs {HAND_EMOJI[gameState.p2_kept]}
                    </div>
                    <div className="text-lg font-semibold text-gray-700">
                      {HAND_NAME[gameState.p1_kept]} vs {HAND_NAME[gameState.p2_kept]}
                      {' → '}
                      {rpsResult(gameState.p1_kept, gameState.p2_kept) === 'draw'
                        ? 'Draw (P1 tiebreak)'
                        : rpsResult(gameState.p1_kept, gameState.p2_kept) === 'p1'
                        ? `${HAND_NAME[gameState.p1_kept]} beats ${HAND_NAME[gameState.p2_kept]}`
                        : `${HAND_NAME[gameState.p2_kept]} beats ${HAND_NAME[gameState.p1_kept]}`}
                    </div>
                  </div>
                )}
                {gameState.winner && (
                  <div className="p-5 bg-white border-2 border-green-200 rounded-xl shadow-lg">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-2">Winner</p>
                    <p className="font-mono text-sm font-bold text-gray-800">{shortAddr(gameState.winner)}</p>
                    {gameState.winner === userAddress && <p className="mt-3 text-green-700 font-black text-lg">🎉 You won!</p>}
                    {gameState.winner !== userAddress && <p className="mt-3 text-gray-600 font-semibold">Better luck next time!</p>}
                  </div>
                )}
              </div>
              <button onClick={resetToCreate}
                className="w-full py-4 rounded-xl font-bold text-gray-700 bg-gradient-to-r from-gray-200 to-gray-300 hover:from-gray-300 hover:to-gray-400 transition-all shadow-lg">
                Start New Game
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
