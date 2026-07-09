/**
 * TG0 — Load the OOC replay scenario from the evidence transcript JSON.
 *
 * Parses `session-2dc74568-transcript.json` and extracts:
 * - Turns 1–259 as seed messages (session history to establish context)
 * - Turns 260–291 as replay turns (user messages to feed to the model)
 * - The emotional axis state at the boundary for seedAxisState
 *
 * The scenario file path defaults to the source plan's evidence location
 * under `documents/ooc issue/` and can be overridden via CLI flag.
 */

import * as fs from "fs";
import * as path from "path";
import type { ReplayScenario, ReplayTurn } from "./replayTypes";

// ---------------------------------------------------------------------------
// Transcript JSON structure
// ---------------------------------------------------------------------------

interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  route: string;
  turn_type: string;
  turn_index: number;
  created_at: string;
  content: string;
  emotional_axis?: Record<string, unknown>;
}

interface TranscriptFile {
  session_id: string;
  title: string;
  message_count: number;
  messages: TranscriptMessage[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First replay turn index (1-indexed, inclusive). */
const REPLAY_START = 260;
/** Last replay turn index (1-indexed, inclusive). */
const REPLAY_END = 291;

// ---------------------------------------------------------------------------
// Default path: resolve relative to the repo root
//
// Strategy: start from process.cwd() (expected to be chatbot/backend/ when
// run via npm script or npx tsx) and walk up to find the repo root
// (D:\Code\Zuo-Ran), then descend into documents/ooc issue/.
// ---------------------------------------------------------------------------

function findRepoRoot(): string {
  // Walk up from cwd to find a directory containing both chatbot/ and documents/
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, "chatbot")) &&
      fs.existsSync(path.join(dir, "documents"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  // Fallback: assume cwd is already the repo root
  return process.cwd();
}

const DEFAULT_TRANSCRIPT_PATH = path.resolve(
  findRepoRoot(),
  "documents",
  "ooc issue",
  "session-2dc74568-transcript.json",
);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load and parse the transcript JSON file.
 */
function loadTranscript(filePath?: string): TranscriptFile {
  const resolved = filePath ?? DEFAULT_TRANSCRIPT_PATH;
  const raw = fs.readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as TranscriptFile;
}

/**
 * Convert 1-indexed turn number to the 0-indexed turn_index used in the transcript.
 */
function turnIndex(turn1Based: number): number {
  return turn1Based - 1;
}

// ---------------------------------------------------------------------------
// Scenario builder
// ---------------------------------------------------------------------------

/**
 * Load the OOC replay scenario from the evidence transcript.
 *
 * @param transcriptPath - Optional override path to the transcript JSON.
 * @returns The parsed ReplayScenario.
 */
export function loadOocReplayScenario(
  transcriptPath?: string,
): ReplayScenario {
  const transcript = loadTranscript(transcriptPath);
  const messages = transcript.messages;

  // Extract seed messages: turns 1–259 (0-indexed turnIndex 0–258)
  const seedMessages: ReplayScenario["seedMessages"] = [];
  // Extract replay turns: turns 260–291 (0-indexed turnIndex 259–290)
  const replayTurns: ReplayTurn[] = [];

  // We also need the assistant replies for turns 1–259 as seed messages
  // (these establish the context history).
  // For replay, we extract user messages for turns 260–291.

  let lastAxisState: Record<string, unknown> | undefined;

  for (const msg of messages) {
    const oneBasedTurn = msg.turn_index + 1;

    if (oneBasedTurn < REPLAY_START) {
      // Seed: include both user and assistant messages
      seedMessages.push({
        role: msg.role,
        content: msg.content,
        turnIndex: msg.turn_index,
      });
      // Capture the last assistant's emotional axis state as the seed boundary
      if (msg.role === "assistant" && msg.emotional_axis) {
        lastAxisState = msg.emotional_axis as Record<string, unknown>;
      }
    } else if (oneBasedTurn <= REPLAY_END) {
      // Replay range: only user messages are fed to the model
      if (msg.role === "user") {
        replayTurns.push({
          turnIndex: msg.turn_index,
          userMessage: msg.content,
          originalAssistantReply: undefined, // not loaded by default
        });
      } else {
        // Store the original assistant reply as reference
        const lastReplayTurn =
          replayTurns[replayTurns.length - 1];
        if (lastReplayTurn) {
          lastReplayTurn.originalAssistantReply = msg.content;
        }
        // Also capture the emotional axis state
        if (msg.emotional_axis) {
          lastAxisState = msg.emotional_axis as Record<string, unknown>;
        }
      }
    }
  }

  return {
    sessionId: transcript.session_id,
    title: transcript.title,
    seedMessages,
    replayTurns,
    seedAxisState: lastAxisState,
  };
}

/**
 * Get the default transcript path (for CLI help / error messages).
 */
export function getDefaultTranscriptPath(): string {
  return DEFAULT_TRANSCRIPT_PATH;
}

export { REPLAY_START, REPLAY_END, DEFAULT_TRANSCRIPT_PATH };
