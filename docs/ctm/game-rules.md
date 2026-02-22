# CTM Game Rules

## Overview

**CTM (Commit-Turn-Move)** is a strategic variant of rock-paper-scissors that adds layers of tactical decision-making through commitment and revelation mechanics. The game combines elements of poker (bluffing and commitment) with traditional rock-paper-scissors strategy.

## Basic Setup

- **Players**: 2
- **Duration**: 5-10 minutes
- **Platform**: Stellar blockchain (Soroban)
- **Stakes**: Configurable points/tokens

## Hand Definitions

Players choose from three classic options:

| Hand | Symbol | Value | Beats |
|------|--------|-------|-------|
| Rock | 🪨 | 0 | Scissors |
| Paper | ✋ | 1 | Rock |
| Scissors | ✌️ | 2 | Paper |

## Game Structure

### Phase 1: Hand Selection & Commitment
**Duration**: Until both players commit

1. Each player secretly selects **two different hands**
2. Players cannot select the same hand twice
3. Selections are committed using cryptographic hashing
4. Once committed, selections cannot be changed

**Strategic Consideration**: Choose hands that give you flexibility for the final duel while considering what your opponent might expect.

### Phase 2: Hand Revelation
**Duration**: Until both players reveal

1. Both players simultaneously reveal their selected hands
2. All four hands become visible to both players
3. Contract verifies that revealed hands match commitments

**Strategic Consideration**: Now you can see your opponent's full hand set. Plan your next move accordingly.

### Phase 3: Choice Commitment
**Duration**: Until both players commit choice

1. Each player chooses **one hand to keep** from their revealed pair
2. The discarded hand is eliminated from play
3. Choice is committed using cryptographic hashing

**Strategic Consideration**: This is the critical decision point. Consider:
- What hand gives you the best chance against opponent's likely choices?
- What hand denies your opponent their strongest option?
- Are you trying to win or force a particular outcome?

### Phase 4: Choice Revelation
**Duration**: Instant resolution

1. Both players reveal their chosen hand
2. Contract verifies choices match commitments
3. Winner determined by rock-paper-scissors rules

### Phase 5: Game Complete
**Duration**: Final

1. Winner receives points/tokens
2. Game state recorded on blockchain
3. Players can start new game

## Winning Conditions

### Primary Victory
- Your kept hand beats opponent's kept hand using standard RPS rules
- Winner takes all points at stake

### Tie Resolution
- If both players keep the same hand, Player 1 wins (by convention)
- This prevents infinite draws

## Strategic Depth

### Hand Selection Strategy

#### Balanced Approach
- Choose Rock + Paper: Covers most scenarios
- Choose Paper + Scissors: Flexible against common plays
- Choose Rock + Scissors: High risk, high reward

#### Aggressive Approach
- Choose hands that beat what opponent expects
- Consider psychological warfare

#### Defensive Approach
- Choose hands that counter opponent's revealed set
- Minimize opponent's winning options

### Choice Strategy

#### After Revelation
- **Counter opponent's strength**: If opponent has Rock + Paper, keep Scissors
- **Play the odds**: Choose hand that beats opponent's most likely choice
- **Psychological play**: Consider what opponent thinks you think they have

#### Advanced Tactics
- **Hand denial**: Choose hand that prevents opponent from using their best option
- **Expectation management**: Sometimes lose the battle to win the war
- **Pattern disruption**: Avoid predictable play

## Example Game

### Setup
- Player A: Rock + Paper
- Player B: Paper + Scissors

### Revelation Phase
Both players see opponent's hands.

### Choice Phase
- Player A sees B has Paper + Scissors
  - If B keeps Paper, A should keep Scissors (Scissors beat Paper)
  - If B keeps Scissors, A should keep Rock (Rock beats Scissors)
  - A chooses Scissors (covers both scenarios)

- Player B sees A has Rock + Paper
  - If A keeps Rock, B should keep Paper (Paper beats Rock)
  - If A keeps Paper, B should keep Scissors (Scissors beat Paper)
  - B chooses Paper (covers both scenarios)

### Resolution
- A keeps Scissors, B keeps Paper
- Scissors beats Paper → **Player A wins**

## Common Mistakes

### Beginner Errors
1. **Poor hand selection**: Choosing same hand twice (invalid)
2. **No strategy**: Random choices without considering opponent
3. **Ignoring revelation**: Not adapting after seeing opponent's hands

### Intermediate Errors
1. **Overthinking**: Analysis paralysis in choice phase
2. **Pattern playing**: Becoming predictable
3. **Ignoring psychology**: Not considering opponent's thought process

### Advanced Considerations
1. **Information leakage**: Revealing strategy through timing
2. **Commitment credibility**: Building reputation through consistent play
3. **Bankroll management**: Proper stake sizing

## Tournament Play

### Best Practices
- **Study opponents**: Learn playing styles
- **Bankroll management**: Don't overcommit
- **Mental preparation**: Stay focused through long sessions

### Meta Strategy
- **Table position**: Later position has information advantage
- **Chip leadership**: Psychological advantage of being ahead
- **Table image**: How opponents perceive your play style

## Technical Rules

### Commitment Protocol
- All commitments use keccak256 hashing
- Random 32-byte salts required
- Salts must remain secret until reveal

### Timing
- No time limits (blockchain-based)
- Players can take time to think strategically
- Contract prevents invalid state transitions

### Validation
- Contract verifies all cryptographic commitments
- Invalid hands rejected
- Phase progression strictly enforced

## Variants

### Speed CTM
- 30-second time limits per phase
- Faster-paced, less strategic

### High Stakes CTM
- Larger point pools
- More pressure, higher variance

### Tournament CTM
- Multiple rounds
- Cumulative scoring
- Elimination brackets

## Learning Resources

### Beginner
- Practice against computer opponents
- Study basic RPS strategy first
- Focus on hand selection fundamentals

### Intermediate
- Analyze professional games
- Learn opponent profiling
- Practice psychological aspects

### Advanced
- Study game theory applications
- Develop personal playing style
- Participate in tournaments