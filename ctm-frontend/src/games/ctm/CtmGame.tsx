import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Swords,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  Share2,
  Trophy,
  Eye,
  Lock,
  BrainCircuit,
  Zap,
  Download,
  Upload,
  Sparkles,
  RotateCcw,
  Send,
} from 'lucide-react';
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

const HAND_EMOJI = ['🗿', '✋', '✌️'] as const;
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

  // Reset selections when switching players
  useEffect(() => {
    setSelectedLeft(null);
    setSelectedRight(null);
    setSelectedKeep(null);
  }, [userAddress]);

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

  // Derive player identity for board-side color switching
  const isP1 = gameState ? gameState.player1 === userAddress : true;

  const HandButton = ({ hand, selected, onSelect, disabled }: { hand: number; selected: boolean; onSelect: () => void; disabled?: boolean }) => (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`relative w-20 h-24 sm:w-24 sm:h-28 rounded-2xl font-bold text-3xl sm:text-4xl transition-all duration-300 flex flex-col items-center justify-center gap-1
        ${selected
          ? `ring-3 shadow-lg scale-105 ${isP1 ? 'bg-amber-50 ring-amber-400 shadow-amber-200/50' : 'bg-violet-50 ring-violet-400 shadow-violet-200/50'}`
          : 'bg-white ring-1 ring-stone-200 hover:ring-stone-300 hover:shadow-md hover:-translate-y-0.5 disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:shadow-none disabled:cursor-not-allowed'
        }`}
    >
      <span className="drop-shadow-sm">{HAND_EMOJI[hand]}</span>
      <span className={`text-[10px] font-semibold tracking-wide uppercase ${selected ? (isP1 ? 'text-amber-600' : 'text-violet-600') : 'text-stone-400'}`}>{HAND_NAME[hand]}</span>
    </button>
  );

  const HandDisplay = ({ hand, label }: { hand: number | undefined | null; label: string }) => (
    <div className="flex-1 p-4 rounded-2xl text-center transition-all duration-300 bg-stone-50 ring-1 ring-stone-200">
      <div className="text-[10px] font-bold tracking-widest uppercase text-stone-400 mb-2">{label}</div>
      <div className="text-3xl sm:text-4xl drop-shadow-sm">{hand != null ? HAND_EMOJI[hand] : '❓'}</div>
      <div className={`text-xs font-semibold mt-2 tracking-wide uppercase ${hand != null ? 'text-stone-600' : 'text-stone-300'}`}>{hand != null ? HAND_NAME[hand] : 'Hidden'}</div>
    </div>
  );

  const PlayerCard = ({ label, address, points, isMe, statusEl }: { label: string; address: string; points: bigint; isMe: boolean; statusEl: React.ReactNode }) => {
    const isPlayer1Card = label === 'Player 1';
    const cardColor = isPlayer1Card ? 'amber' : 'violet';
    return (
      <div className={`relative p-5 rounded-2xl transition-all duration-300 overflow-hidden
        ${isMe
          ? `bg-gradient-to-br ring-2 shadow-lg ${cardColor === 'amber' ? 'from-amber-50 to-orange-50/50 ring-amber-300 shadow-amber-100/50' : 'from-violet-50 to-indigo-50/50 ring-violet-300 shadow-violet-100/50'}`
          : 'bg-stone-50 ring-1 ring-stone-200'
        }`}>
        {isMe && <div className={`absolute top-0 left-0 w-full h-1 ${cardColor === 'amber' ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-violet-400 to-indigo-400'}`} />}
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className={`text-xs font-bold uppercase tracking-widest ${isMe ? (cardColor === 'amber' ? 'text-amber-600' : 'text-violet-600') : 'text-stone-400'}`}>
              {label} {isMe && <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${cardColor === 'amber' ? 'bg-amber-200/60 text-amber-700' : 'bg-violet-200/60 text-violet-700'}`}>YOU</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Points</div>
            <div className="text-lg font-bold text-stone-800">{(Number(points) / 1e7).toFixed(2)}</div>
          </div>
        </div>
        <div className="font-mono text-xs text-stone-400 bg-white/80 px-3 py-1.5 rounded-lg ring-1 ring-stone-100 mb-3">{shortAddr(address)}</div>
        <div>{statusEl}</div>
      </div>
    );
  };

  const StatusBadge = ({ done, text }: { done: boolean; text?: string }) => (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all duration-300
      ${done ? 'bg-teal-50 text-teal-600 ring-1 ring-teal-200' : 'bg-stone-100 text-stone-400 ring-1 ring-stone-200'}`}>
      {done ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> : <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
      {done ? (text || '✓ Done') : (text || 'Waiting…')}
    </span>
  );

  const WaitingBanner = ({ msg }: { msg: string }) => (
    <div className={`relative p-6 rounded-2xl mt-6 overflow-hidden ring-1 ${isP1 ? 'bg-amber-50/50 ring-amber-200' : 'bg-violet-50/50 ring-violet-200'}`}>
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isP1 ? 'bg-amber-100' : 'bg-violet-100'}`}>
          <Loader2 className={`w-5 h-5 animate-spin ${isP1 ? 'text-amber-500' : 'text-violet-500'}`} />
        </div>
        <p className="text-sm font-medium text-stone-600 leading-relaxed">{msg}</p>
      </div>
    </div>
  );

  // Phase stepper
  const PHASE_NAMES = ['Commit', 'Reveal', 'Choose', 'Showdown', 'Done'];
  const PhaseStep = ({ phase }: { phase: number }) => (
    <div className="flex items-center justify-center gap-1 sm:gap-2">
      {[1, 2, 3, 4, 5].map((p) => (
        <div key={p} className="flex items-center gap-1 sm:gap-2">
          <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-all duration-500
            ${phase === p ? (isP1 ? 'bg-amber-400 text-white ring-4 ring-amber-100 shadow-md' : 'bg-violet-400 text-white ring-4 ring-violet-100 shadow-md') :
              phase > p ? 'bg-stone-800 text-white' : 'bg-stone-200 text-stone-400'}`}>
            {phase > p ? '✓' : p}
          </div>
          {p < 5 && <div className={`w-4 sm:w-8 h-0.5 rounded-full transition-all duration-500 ${phase > p ? 'bg-stone-800' : 'bg-stone-200'}`} />}
        </div>
      ))}
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

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className={`relative rounded-[2rem] p-6 md:p-10 shadow-xl overflow-hidden transition-colors duration-700
      ${gamePhase === 'playing' && gameState
        ? (isP1 ? 'bg-gradient-to-br from-white via-amber-50/40 to-white ring-1 ring-amber-200/60' : 'bg-gradient-to-br from-white via-violet-50/40 to-white ring-1 ring-violet-200/60')
        : 'bg-white/95 ring-1 ring-stone-200/80'}
      backdrop-blur-xl`}>

      {/* Subtle texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'40\' height=\'40\' viewBox=\'0 0 40 40\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%239C92AC\' fill-opacity=\'0.4\' fill-rule=\'evenodd\'%3E%3Cpath d=\'M0 40L40 0H20L0 20M40 40V20L20 40\'/%3E%3C/g%3E%3C/svg%3E")' }} />

      {/* Header */}
      <div className="relative z-10 flex flex-col items-center text-center mb-8 pb-6 border-b border-stone-200/80">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className={`w-5 h-5 ${gamePhase === 'playing' && gameState ? (isP1 ? 'text-amber-400' : 'text-violet-400') : 'text-stone-400'}`} />
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-stone-800" style={{ fontFamily: 'var(--font-serif)' }}>
            Commit · Turn · Move
          </h2>
          <Sparkles className={`w-5 h-5 ${gamePhase === 'playing' && gameState ? (isP1 ? 'text-amber-400' : 'text-violet-400') : 'text-stone-400'}`} />
        </div>
        <p className="text-xs text-stone-400 font-medium tracking-widest uppercase mt-1">Evolved Rock-Paper-Scissors with ZK Commitments</p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
          <span className="px-3 py-1 rounded-full bg-stone-100 text-[10px] font-mono text-stone-400 tracking-wider flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> {sessionId}
          </span>
          {gameState && <PhaseStep phase={gameState.phase} />}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="relative z-10 mb-6 p-4 bg-rose-50 ring-1 ring-rose-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium text-rose-700 leading-relaxed">{error}</p>
        </div>
      )}
      {success && (
        <div className="relative z-10 mb-6 p-4 bg-teal-50 ring-1 ring-teal-200 rounded-xl flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium text-teal-700 leading-relaxed">{success}</p>
        </div>
      )}

      {/* ================================================================= */}
      {/* CREATE PHASE                                                       */}
      {/* ================================================================= */}
      {gamePhase === 'create' && (
        <div className="relative z-10 space-y-6">
          {/* Mode toggle — segmented control */}
          <div className="flex items-center justify-center gap-1 p-1 bg-stone-100 rounded-full w-fit mx-auto">
            {(['create', 'import', 'load'] as const).map((m) => (
              <button key={m} onClick={() => { setCreateMode(m); setExportedAuthEntryXDR(null); }}
                className={`py-2.5 px-5 rounded-full text-xs font-bold uppercase tracking-widest transition-all duration-300
                  ${createMode === m ? 'bg-white text-stone-800 shadow-md ring-1 ring-stone-200' : 'text-stone-400 hover:text-stone-600'}`}>
                {m === 'create' ? 'Create' : m === 'import' ? 'Import' : 'Load'}
              </button>
            ))}
          </div>

          {/* Quickstart */}
          <div className="p-5 bg-amber-50/60 ring-1 ring-amber-200/80 rounded-2xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1 flex items-center gap-1.5">
                  <Zap className="w-4 h-4" /> Quickstart
                </p>
                <p className="text-xs text-stone-500">Creates a full RPS demo with dev wallets.</p>
              </div>
              <button onClick={handleQuickStart} disabled={isBusy || !quickstartAvailable}
                className="px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest text-white bg-amber-500 hover:bg-amber-600 disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md flex items-center gap-2">
                {quickstartLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {quickstartLoading ? 'Running…' : 'Go'}
              </button>
            </div>
          </div>

          {/* --- CREATE MODE --- */}
          {createMode === 'create' && (
            <div className="space-y-5 bg-stone-50/50 p-6 md:p-8 rounded-2xl ring-1 ring-stone-200/80">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-500 ml-0.5">Your Address (Player 1)</label>
                <input type="text" value={player1Address} onChange={(e) => setPlayer1Address(e.target.value.trim())} placeholder="G…"
                  className="w-full px-4 py-3 rounded-xl bg-white ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-amber-300 text-sm font-mono text-stone-700 placeholder-stone-300 transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-500 ml-0.5">Your Points</label>
                <input type="text" value={player1Points} onChange={(e) => setPlayer1Points(e.target.value)} placeholder="0.1"
                  className="w-full px-4 py-3 rounded-xl bg-white ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-amber-300 text-sm font-mono text-stone-700 placeholder-stone-300 transition-all" />
                <p className="text-[10px] font-medium text-stone-400 mt-1 ml-0.5">Available: {(Number(availablePoints) / 1e7).toFixed(2)} Points</p>
              </div>
              <div className="p-3 bg-sky-50 ring-1 ring-sky-200 rounded-xl flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-sky-700 leading-relaxed">Player 2 will specify their own address and points when importing.</p>
              </div>
              {!exportedAuthEntryXDR ? (
                <button onClick={handlePrepare} disabled={isBusy}
                  className="w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-white bg-stone-800 hover:bg-stone-700 disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md mt-2 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {loading ? 'Preparing…' : 'Prepare & Export'}
                </button>
              ) : (
                <div className="space-y-4 mt-4">
                  <div className="p-5 bg-teal-50 ring-1 ring-teal-200 rounded-2xl">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-teal-600 mb-3 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" /> Auth Entry XDR
                    </p>
                    <div className="bg-white p-3 rounded-xl ring-1 ring-teal-100 mb-4 max-h-28 overflow-y-auto">
                      <code className="text-[11px] font-mono text-stone-500 break-all leading-relaxed">{exportedAuthEntryXDR}</code>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button onClick={copyAuth} className="py-3 rounded-xl bg-white ring-1 ring-teal-200 text-teal-600 hover:bg-teal-50 font-bold text-xs uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2">
                        {authEntryCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {authEntryCopied ? 'Copied!' : 'Copy XDR'}
                      </button>
                      <button onClick={copyShareUrl} className="py-3 rounded-xl bg-white ring-1 ring-violet-200 text-violet-600 hover:bg-violet-50 font-bold text-xs uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2">
                        {shareUrlCopied ? <CheckCircle2 className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                        {shareUrlCopied ? 'Copied!' : 'Share URL'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --- IMPORT MODE --- */}
          {createMode === 'import' && (
            <div className="space-y-4">
              <div className="p-6 bg-violet-50/60 ring-1 ring-violet-200/80 rounded-2xl space-y-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600 flex items-center gap-1.5">
                  <Download className="w-4 h-4" /> Import Auth Entry from Player 1
                </p>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-2 ml-0.5">
                    Auth Entry XDR
                    {xdrParsing && <span className="text-violet-500 animate-pulse">Parsing…</span>}
                    {xdrParseSuccess && <span className="text-teal-600">✓ Parsed</span>}
                    {xdrParseError && <span className="text-rose-500">✗ Error</span>}
                  </label>
                  <textarea value={importAuthEntryXDR} onChange={(e) => setImportAuthEntryXDR(e.target.value)} rows={4} placeholder="Paste auth entry XDR…"
                    className={`w-full px-4 py-3 rounded-xl bg-white ring-1 focus:outline-none focus:ring-2 text-sm font-mono text-stone-700 placeholder-stone-300 transition-all resize-none
                      ${xdrParseError ? 'ring-rose-300 focus:ring-rose-400' : xdrParseSuccess ? 'ring-teal-300 focus:ring-teal-400' : 'ring-stone-200 focus:ring-violet-300'}`} />
                  {xdrParseError && <p className="text-[10px] font-medium text-rose-500 mt-1.5 ml-0.5">{xdrParseError}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 ml-0.5">Session ID</label><input readOnly value={importSessionId} className="w-full px-3 py-2.5 rounded-xl bg-stone-100 ring-1 ring-stone-200 text-xs font-mono text-stone-400 cursor-not-allowed" /></div>
                  <div><label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 ml-0.5">P1 Points</label><input readOnly value={importPlayer1Points} className="w-full px-3 py-2.5 rounded-xl bg-stone-100 ring-1 ring-stone-200 text-xs text-stone-400 cursor-not-allowed" /></div>
                </div>
                <div><label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 ml-0.5">Player 1</label><input readOnly value={importPlayer1} className="w-full px-3 py-2.5 rounded-xl bg-stone-100 ring-1 ring-stone-200 text-xs font-mono text-stone-400 cursor-not-allowed" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 ml-0.5">You (P2)</label><input readOnly value={userAddress} className="w-full px-3 py-2.5 rounded-xl bg-stone-100 ring-1 ring-stone-200 text-xs font-mono text-stone-400 cursor-not-allowed" /></div>
                  <div><label className="block text-[10px] font-bold uppercase tracking-widest text-violet-600 mb-1 ml-0.5">Your Points *</label><input type="text" value={importPlayer2Points} onChange={(e) => setImportPlayer2Points(e.target.value)} placeholder="0.1" className="w-full px-3 py-2.5 rounded-xl bg-white ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-violet-300 text-xs font-mono text-stone-700 placeholder-stone-300 transition-all" /></div>
                </div>
              </div>
              <button onClick={handleImport} disabled={isBusy || !importAuthEntryXDR.trim()}
                className="w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-white bg-violet-600 hover:bg-violet-700 disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md mt-2 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {loading ? 'Importing…' : 'Import & Sign'}
              </button>
            </div>
          )}

          {/* --- LOAD MODE --- */}
          {createMode === 'load' && (
            <div className="space-y-5 bg-stone-50/50 p-6 md:p-8 rounded-2xl ring-1 ring-stone-200/80">
              <div className="p-5 bg-teal-50/60 ring-1 ring-teal-200/80 rounded-2xl space-y-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-teal-600 flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4" /> Load Existing Game
                </p>
                <input type="text" value={loadSessionId} onChange={(e) => setLoadSessionId(e.target.value)} placeholder="Session ID"
                  className="w-full px-4 py-3 rounded-xl bg-white ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-300 text-sm font-mono text-stone-700 placeholder-stone-300 transition-all" />
              </div>
              <button onClick={handleLoad} disabled={isBusy || !loadSessionId.trim()}
                className="w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-white bg-teal-600 hover:bg-teal-700 disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {loading ? 'Loading…' : 'Load Game'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* PLAYING PHASE                                                      */}
      {/* ================================================================= */}
      {gamePhase === 'playing' && gameState && (
        <div className="space-y-5 relative z-10">
          {/* Board layout — opponent top, you bottom */}
          <div className="flex flex-col gap-3">
            {/* Opponent card (always on top) */}
            <PlayerCard
              label={gameState.player1 === userAddress ? 'Player 2' : 'Player 1'}
              address={gameState.player1 === userAddress ? gameState.player2 : gameState.player1}
              points={gameState.player1 === userAddress ? gameState.player2_points : gameState.player1_points}
              isMe={false}
              statusEl={gameState.player1 === userAddress ? p2Status(gameState) : p1Status(gameState)}
            />
            {/* VS divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-stone-200" />
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black ring-2 shadow-sm
                ${isP1 ? 'bg-amber-50 ring-amber-300 text-amber-600' : 'bg-violet-50 ring-violet-300 text-violet-600'}`}>
                <Swords className="w-4 h-4" />
              </div>
              <div className="flex-1 h-px bg-stone-200" />
            </div>
            {/* Your card (always on bottom) */}
            <PlayerCard
              label={gameState.player1 === userAddress ? 'Player 1' : 'Player 2'}
              address={userAddress}
              points={gameState.player1 === userAddress ? gameState.player1_points : gameState.player2_points}
              isMe={true}
              statusEl={gameState.player1 === userAddress ? p1Status(gameState) : p2Status(gameState)}
            />
          </div>

          {/* ---- Phase 1: Commit Hands ---- */}
          {uiPhase === 'commit_hands' && (
            <div className={`space-y-5 p-6 md:p-8 rounded-2xl ring-1 transition-all duration-500 ${isP1 ? 'bg-amber-50/30 ring-amber-200/60' : 'bg-violet-50/30 ring-violet-200/60'}`}>
              <div className="flex items-center gap-2.5">
                <Lock className={`w-5 h-5 ${isP1 ? 'text-amber-500' : 'text-violet-500'}`} />
                <h3 className="text-base font-bold text-stone-800" style={{ fontFamily: 'var(--font-serif)' }}>Choose Two Hands</h3>
              </div>
              <p className="text-xs text-stone-500">Pick two <strong className={isP1 ? 'text-amber-600' : 'text-violet-600'}>different</strong> figures. They'll be hidden until both players commit.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="p-4 bg-white rounded-xl ring-1 ring-stone-200/80">
                  <p className="text-[10px] font-bold text-stone-400 mb-3 uppercase tracking-widest">Left Hand</p>
                  <div className="flex gap-2.5">
                    {[0, 1, 2].map((h) => <HandButton key={h} hand={h} selected={selectedLeft === h} onSelect={() => setSelectedLeft(h)} disabled={selectedRight === h} />)}
                  </div>
                </div>
                <div className="p-4 bg-white rounded-xl ring-1 ring-stone-200/80">
                  <p className="text-[10px] font-bold text-stone-400 mb-3 uppercase tracking-widest">Right Hand</p>
                  <div className="flex gap-2.5">
                    {[0, 1, 2].map((h) => <HandButton key={h} hand={h} selected={selectedRight === h} onSelect={() => setSelectedRight(h)} disabled={selectedLeft === h} />)}
                  </div>
                </div>
              </div>
              <button onClick={handleCommitHands} disabled={isBusy || selectedLeft === null || selectedRight === null || selectedLeft === selectedRight}
                className={`w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-white disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md mt-2 flex items-center justify-center gap-2
                  ${isP1 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-violet-500 hover:bg-violet-600'}`}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {loading ? 'Committing…' : `Commit: ${selectedLeft != null ? HAND_EMOJI[selectedLeft] : '?'} + ${selectedRight != null ? HAND_EMOJI[selectedRight] : '?'}`}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_commits' && <WaitingBanner msg="Your hands are committed. Waiting for opponent to commit…" />}

          {/* ---- Phase 2: Reveal Hands ---- */}
          {uiPhase === 'reveal_hands' && (
            <div className={`space-y-5 p-6 md:p-8 rounded-2xl ring-1 transition-all duration-500 ${isP1 ? 'bg-amber-50/30 ring-amber-200/60' : 'bg-violet-50/30 ring-violet-200/60'}`}>
              <div className="flex items-center gap-2.5">
                <Eye className={`w-5 h-5 ${isP1 ? 'text-amber-500' : 'text-violet-500'}`} />
                <h3 className="text-base font-bold text-stone-800" style={{ fontFamily: 'var(--font-serif)' }}>Reveal Your Hands</h3>
              </div>
              <p className="text-xs text-stone-500">Both players committed. Click below to reveal your hands (verified on-chain).</p>
              <button onClick={handleRevealHands} disabled={isBusy}
                className={`w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-white disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md flex items-center justify-center gap-2
                  ${isP1 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-violet-500 hover:bg-violet-600'}`}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                {loading ? 'Revealing…' : 'Reveal Hands'}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_reveals' && <WaitingBanner msg="Your hands are revealed. Waiting for opponent…" />}

          {/* ---- Phase 3: Commit Choice ---- */}
          {uiPhase === 'commit_choice' && (
            <div className={`space-y-5 p-6 md:p-8 rounded-2xl ring-1 transition-all duration-500 ${isP1 ? 'bg-amber-50/30 ring-amber-200/60' : 'bg-violet-50/30 ring-violet-200/60'}`}>
              <div className="flex items-center gap-2.5">
                <BrainCircuit className={`w-5 h-5 ${isP1 ? 'text-amber-500' : 'text-violet-500'}`} />
                <h3 className="text-base font-bold text-stone-800" style={{ fontFamily: 'var(--font-serif)' }}>Strategic Removal</h3>
              </div>
              <p className="text-xs text-stone-500">All hands are visible! Choose which of <strong className={isP1 ? 'text-amber-600' : 'text-violet-600'}>your</strong> hands to <strong className={isP1 ? 'text-amber-600' : 'text-violet-600'}>keep</strong> for the duel.</p>

              {/* Show all 4 hands */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="p-4 bg-white rounded-xl ring-1 ring-stone-200/80 space-y-3">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isP1 ? 'text-amber-500' : 'text-violet-500'}`}>Your Hands</p>
                  <div className="flex gap-2.5">
                    {[
                      { idx: 0, hand: gameState.player1 === userAddress ? gameState.p1_left : gameState.p2_left, label: 'Left' },
                      { idx: 1, hand: gameState.player1 === userAddress ? gameState.p1_right : gameState.p2_right, label: 'Right' },
                    ].map(({ idx, hand, label }) => (
                      <button key={idx} onClick={() => setSelectedKeep(idx)} disabled={hand == null}
                        className={`flex-1 p-3 rounded-xl ring-1 text-center transition-all duration-300
                          ${selectedKeep === idx
                            ? (isP1 ? 'ring-2 ring-amber-400 bg-amber-50 shadow-md -translate-y-1' : 'ring-2 ring-violet-400 bg-violet-50 shadow-md -translate-y-1')
                            : 'ring-stone-200 bg-white hover:ring-stone-300 hover:bg-stone-50'}`}>
                        <div className="text-3xl">{hand != null ? HAND_EMOJI[hand] : '?'}</div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mt-2">{label}</div>
                        {selectedKeep === idx && <div className={`text-[10px] font-bold uppercase tracking-widest mt-1.5 animate-pulse ${isP1 ? 'text-amber-500' : 'text-violet-500'}`}>KEEP ✓</div>}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-4 bg-white rounded-xl ring-1 ring-stone-200/80 space-y-3">
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Opponent's Hands</p>
                  <div className="flex gap-2.5">
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_left : gameState.p1_left} label="Left" />
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_right : gameState.p1_right} label="Right" />
                  </div>
                </div>
              </div>

              <button onClick={handleCommitChoice} disabled={isBusy || selectedKeep === null}
                className={`w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-white disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md mt-2 flex items-center justify-center gap-2
                  ${isP1 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-violet-500 hover:bg-violet-600'}`}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
                {loading ? 'Committing…' : `Keep ${selectedKeep != null ? (selectedKeep === 0 ? 'Left' : 'Right') : '?'} Hand`}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_choices' && (
            <div className="space-y-5">
              <WaitingBanner msg="Your choice is committed. Waiting for opponent to choose…" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="p-4 bg-white rounded-xl ring-1 ring-stone-200/80 space-y-3">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isP1 ? 'text-amber-500' : 'text-violet-500'}`}>Your Hands</p>
                  <div className="flex gap-2.5">
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p1_left : gameState.p2_left} label="Left" />
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p1_right : gameState.p2_right} label="Right" />
                  </div>
                </div>
                <div className="p-4 bg-white rounded-xl ring-1 ring-stone-200/80 space-y-3">
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Opponent's Hands</p>
                  <div className="flex gap-2.5">
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_left : gameState.p1_left} label="Left" />
                    <HandDisplay hand={gameState.player1 === userAddress ? gameState.p2_right : gameState.p1_right} label="Right" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- Phase 4: Reveal Choice ---- */}
          {uiPhase === 'reveal_choice' && (
            <div className={`space-y-5 p-6 md:p-8 rounded-2xl ring-1 transition-all duration-500 ${isP1 ? 'bg-amber-50/30 ring-amber-200/60' : 'bg-violet-50/30 ring-violet-200/60'}`}>
              <div className="flex items-center gap-2.5">
                <Swords className={`w-5 h-5 ${isP1 ? 'text-amber-500' : 'text-violet-500'}`} />
                <h3 className="text-base font-bold text-stone-800" style={{ fontFamily: 'var(--font-serif)' }}>Reveal Your Choice</h3>
              </div>
              <p className="text-xs text-stone-500">Both players have chosen. Reveal your choice to determine the winner!</p>
              <button onClick={handleRevealChoice} disabled={isBusy}
                className={`w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-white disabled:bg-stone-200 disabled:text-stone-400 transition-all duration-300 shadow-sm hover:shadow-md flex items-center justify-center gap-2
                  ${isP1 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-violet-500 hover:bg-violet-600'}`}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
                {loading ? 'Revealing…' : 'Reveal Choice'}
              </button>
            </div>
          )}
          {uiPhase === 'waiting_final' && <WaitingBanner msg="Your choice is revealed. Waiting for opponent's reveal…" />}

          {/* ---- Phase 5: Complete ---- */}
          {uiPhase === 'complete' && (
            <div className="space-y-5">
              <div className="p-8 md:p-10 bg-white rounded-2xl ring-1 ring-stone-200 text-center relative overflow-hidden">
                {/* Celebratory gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 via-white to-violet-50/50 pointer-events-none" />

                <div className="relative z-10">
                  <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-5 shadow-lg
                    ${gameState.winner === userAddress ? 'bg-amber-100 ring-4 ring-amber-200' : 'bg-stone-100 ring-4 ring-stone-200'}`}>
                    <Trophy className={`w-10 h-10 ${gameState.winner === userAddress ? 'text-amber-500' : 'text-stone-400'}`} />
                  </div>
                  <h3 className="text-2xl font-bold text-stone-800 mb-5" style={{ fontFamily: 'var(--font-serif)' }}>Game Complete!</h3>

                  {gameState.p1_kept != null && gameState.p2_kept != null && (
                    <div className="space-y-5 mb-6">
                      <div className="flex items-center justify-center gap-5">
                        <div className="w-20 h-20 rounded-2xl bg-amber-50 ring-1 ring-amber-200 flex items-center justify-center text-4xl shadow-inner">
                          {HAND_EMOJI[gameState.p1_kept]}
                        </div>
                        <div className="text-lg font-bold text-stone-300 italic">VS</div>
                        <div className="w-20 h-20 rounded-2xl bg-violet-50 ring-1 ring-violet-200 flex items-center justify-center text-4xl shadow-inner">
                          {HAND_EMOJI[gameState.p2_kept]}
                        </div>
                      </div>
                      <div className="inline-block px-5 py-2.5 rounded-full bg-stone-50 ring-1 ring-stone-200">
                        <span className="text-sm font-medium text-stone-600">
                          {HAND_NAME[gameState.p1_kept]} vs {HAND_NAME[gameState.p2_kept]}
                        </span>
                        <span className="mx-2 text-stone-300">→</span>
                        <span className="text-sm font-bold text-teal-600">
                          {rpsResult(gameState.p1_kept, gameState.p2_kept) === 'draw'
                            ? 'Draw (P1 tiebreak)'
                            : rpsResult(gameState.p1_kept, gameState.p2_kept) === 'p1'
                            ? `${HAND_NAME[gameState.p1_kept]} beats ${HAND_NAME[gameState.p2_kept]}`
                            : `${HAND_NAME[gameState.p2_kept]} beats ${HAND_NAME[gameState.p1_kept]}`}
                        </span>
                      </div>
                    </div>
                  )}
                  {gameState.winner && (
                    <div className="p-5 bg-stone-50 ring-1 ring-stone-200 rounded-xl max-w-sm mx-auto">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">Winner</p>
                      <p className="font-mono text-sm text-stone-600 bg-white py-1.5 px-3 rounded-lg inline-block ring-1 ring-stone-200">{shortAddr(gameState.winner)}</p>
                      {gameState.winner === userAddress && <p className="mt-3 text-amber-500 font-bold text-lg">🎉 You won!</p>}
                      {gameState.winner !== userAddress && <p className="mt-3 text-stone-400 font-medium">Better luck next time!</p>}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={resetToCreate}
                className="w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest text-stone-600 bg-stone-100 hover:bg-stone-200 ring-1 ring-stone-200 transition-all duration-300 hover:shadow-sm flex items-center justify-center gap-2">
                <RotateCcw className="w-4 h-4" /> Start New Game
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
