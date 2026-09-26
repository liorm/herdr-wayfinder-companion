# Handoff: Detecting, Inspecting, and Prompting Sibling Agents in Herdr

## Overview & Context
This document captures findings and operational procedures for discovering, inspecting, and driving sibling agents within **Herdr** (a terminal multiplexer tailored for coding agents).

All interactions require running within an active Herdr session (`HERDR_ENV=1`).

---

## 1. Discovering & Detecting Sibling Agents

### Determining Current Pane & Sibling Location
Each agent running under Herdr has its pane ID exposed in the environment:
```bash
echo "$HERDR_PANE_ID"  # e.g., wK:pK
```

To find sibling panes in the current tab or workspace:
```bash
herdr pane list
# or
herdr agent list
```

**JSON Output Inspection (`herdr agent list` / `herdr pane list`):**
* Match the caller's `tab_id` (e.g., `wK:t3`) across panes.
* Any other pane sharing the same `tab_id` with an active `agent` field is a sibling agent pane (e.g., `wK:pC`).

### Agent State Detection & Heuristics (`herdr agent explain`)
Herdr evaluates terminal output buffers against configured heuristic rules for each agent kind (`agy`, `grok`, `claude`, `codex`, etc.).
```bash
herdr agent explain <TARGET_PANE_OR_NAME> [--json]
```
Returns:
* `state`: Current lifecycle state (`idle`, `working`, `blocked`, `done`, `unknown`).
* `matched_rule`: The heuristic rule triggered (e.g., spinner matching `^\s*[\u2800-\u28FF]+\s+\w+ing`, permission prompts).
* `evaluated_rules`: List of rules evaluated with matched regions, byte lengths, and previews.
* `visible_blocker` / `visible_working` / `visible_idle`: Status flags.

---

## 2. Information Obtainable from an Agent

Using `herdr agent get <TARGET>` and `herdr agent read <TARGET>`:

### Metadata & Identity
* **Agent Kind**: e.g., `grok`, `agy`, `claude`, `codex`.
* **Session Details**: `agent_session.value` (UUID/session ID), `agent_session.source`.
* **Topology**: `pane_id`, `tab_id`, `workspace_id`, `terminal_id`, `terminal_title`.
* **Directories**: `cwd` (session root) and `foreground_cwd` (active process directory).
* **Focus State**: `focused: true/false`.

### Execution & Lifecycle Status
* **`agent_status`**:
  * `idle`: Ready to accept prompt.
  * `working`: Actively processing / executing tools.
  * `blocked`: Awaiting user input, confirmation dialog, or permission approval.
  * `done`: Finished turn.
* **Sequence Tracking**: `state_change_seq` and `revision` for detecting state transitions.

### Terminal Content & Buffers
```bash
herdr agent read <TARGET> --source <SOURCE> --lines <N> [--format text|ansi]
```
* Sources:
  * `recent-unwrapped`: Output with soft line wraps joined (ideal for logs, transcripts, and LLM responses).
  * `visible`: Current viewport.
  * `recent`: Viewport plus host scrollback (preserving soft wraps).
  * `detection`: Plain-text bottom buffer snapshot used for agent state detection.

---

## 3. Prompting and Driving Sibling Agents

### Submitting Prompts
```bash
# Asynchronous / instantaneous prompt (useful for slash commands):
herdr agent prompt <TARGET> "/clear"
herdr agent prompt <TARGET> "/model Grok 4.7 low"

# Synchronous prompt with lifecycle waiting:
herdr agent prompt <TARGET> "hi" --wait --timeout 120000
```

### Prompting Behavior & Safety Rules
* **Activity Gate (`--wait`)**: Herdr requires an observed transition to `working` or `blocked` within 5,000ms after prompt submission. If no activity occurs, it returns `agent_prompt_stalled`.
* **Settled State Completion**: Once activity is detected, `--wait` tracks lifecycle status and resolves when the agent returns to `idle`, `done`, or `blocked`.
* **State Filtering (`--until`)**: Specify exact target states if waiting for a specific event (e.g. `--until blocked`).
* **Blocked Rejection**: If an agent is already in a `blocked` state (e.g., asking for approval), `herdr agent prompt` rejects input immediately with `agent_blocked`.
* **Direct Keystroke Injection**:
  ```bash
  herdr agent send-keys <TARGET> esc
  herdr agent send-keys <TARGET> ctrl+c
  ```

---

## 4. Reference Implementation

A fully working driver script demonstrating sibling discovery, session clearing, model switching, prompting, and output reading is located at:
* [`drive_sibling_agent.py`](drive_sibling_agent.py)

---

## 5. Suggested Skills

For the next agent continuing or expanding on this work:
* **`herdr`**: To interface with the Herdr CLI (`herdr --skill`), inspect pane topology, create splits, and coordinate multi-agent workflows.
* **`codebase-design`**: If designing reusable orchestration libraries or background worker abstractions around Herdr.
