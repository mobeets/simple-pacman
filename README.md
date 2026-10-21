# Pacman browser task

A p5.js human behavioral task built on [mobeets/websockets_task](https://github.com/mobeets/websockets_task). The JavaScript environment recreates the supplied Python GhostMDP maze and reward structure with the requested real-time controls, lives, and animations. Python only serves the page and writes data; it does not run the game simulation.

## Run

Install [uv](https://docs.astral.sh/uv/), then from this directory:

```sh
uv run python server.py --logdir logs
```

Open http://localhost:8000/?subject_id=TEST. Click **Play**, or press Enter/Space or gamepad South/Start. During a game, **Space**, **P**, or gamepad **Start** toggles pause. Only white “PAUSED” text appears on a black screen while paused. Use arrow keys/WASD, gamepad D-pad, or left stick. All simulation, assets, and p5 are served locally.

Pacman stops at every node. Each departure requires a fresh press; holding a key does not repeat. While moving, an opposite direction reverses immediately. Other requests are discarded, with no buffering. Invalid directions at a node leave Pacman stationary. Controller inputs received during transition animations are recorded but have no gameplay effect. Moving the stick into a new cardinal direction counts as a fresh request.

A game is one episode, ending when all three lives are lost. Menu high scores last until the page is reloaded; the most recent game’s row is bold. The renderer uses Helvetica, double blue wall outlines on black, life icons, and chomping only while moving. During offense, a ghost excludes the direction toward Pacman when Pacman occupies the next node or the intervening corridor; otherwise its choices remain random. Defense uses a **blue ghost with ordinary eyes and no mouth**; offense uses a **red ghost with dot eyes and squiggly mouth**, per the requested palette. Ghosts never blink.

## Files to edit

- `static/configs/default.json`: all game parameters.
- `static/environment.js`: headless simulation; no p5/DOM/network dependency. Exports `GhostGridEnv`, action/context constants, and seeded `Random` to browsers and Node. Main methods: `reset()`, `action(direction)`, `step()`, `snapshot()`, `drainEvents()`.
- `static/renderer.js`: p5 drawing and animation only.
- `static/task_controls.js`: keyboard/gamepad input interpretation.
- `static/task_logger.js`: task event schema, batching, session JSON export.
- `static/sketch.js`: setup, fixed-timestep loop, focus/connection handling, menus.

`server.py`, `static/ws_logger.js`, `static/unified_controller.js`, and `static/gamepad.js` are unchanged. `index.html` adds script imports; CSS makes the canvas fill the window. No Python edits are needed to change the task.

## Configuration

Duplicate `static/configs/default.json`, then open `/?config=NAME&subject_id=TEST` to load `static/configs/NAME.json`. Config names allow letters, numbers, underscores, and hyphens. A null seed draws a new seed at page load and records it; a numeric seed reproduces random choices for an identical sequence of simulation steps and actions.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `size` | 5 | Maze grid size; nine nodes at rows/columns 0, 2, 4 |
| `lives` | 3 | Lives per game |
| `simulation_hz` | 60 | Fixed simulation ticks per active browser second |
| `pacman_speed` | 5 | Grid cells per second |
| `ghost_speed` | 4 | Grid cells per second |
| `ghost_decision_bin_s` | 0.25 | Ghost decision opportunities on the active-time clock |
| `ghost_stay_probability` | 0.2 | Probability of staying when stationary at a decision bin |
| `context_bin_s` | 0.2 | Geometric context/pellet checks |
| `defense_mean_duration_s` | 4 | Mean defense duration without pellets, in active gameplay seconds |
| `offense_mean_duration_s` | 6 | Mean offense duration in active gameplay seconds |
| `use_power_pellet` | true | If true, defense ends only by eating the pellet |
| `power_pellet_mean_delay_s` | 4 | Mean delay from entering defense to pellet appearance |
| `power_pellet_points` | 10 | Points for consuming a pellet |
| `reward_bin_s` | 0.2 | Periodic reward interval |
| `defense_survival_reward` | 1 | Points per noncontact defense reward bin |
| `defense_contact_reward` | 0 | Points on defensive contact, plus loss of one life |
| `offense_step_reward` | 0 | Points per noncontact offense reward bin |
| `offense_contact_reward` | 20 | Points for capturing ghost |
| `respawn_min_distance` | 2 | Minimum maze distance for ghost respawn |
| `collision_distance` | 0.42 | Entity contact threshold in grid units |
| `pellet_eat_distance` | 0.3 | Pellet collection threshold in grid units |
| `transition_duration_s` | 1 | Duration of each transition animation |

For a bin size `b` and mean duration `m`, each bin independently succeeds with probability `b/m`. The first opportunity is after one bin. Thus the expected duration is exactly `m`; mean durations must be at least one bin. A four-second mean with 0.2-second bins corresponds to the supplied Python probability 0.05; the default offense mean is six seconds. Animation time is excluded from these clocks. Once a pellet appears it remains until eaten. Positions exclude the entities' current collision/collection neighborhoods.

## Simulation details and differences from Python

Coordinates are zero-based `[row, column]`; actions are `0=up, 1=right, 2=down, 3=left`; contexts are `0=defense, 1=offense`. There are 21 accessible grid cells and nine junction/corner nodes. Continuous positions are restricted to corridor edges. Pacman and ghost move smoothly at fixed simulation ticks, including swept collision detection to catch head-on crossings.

At game start, distinct Pacman/ghost node pairs are sampled without replacement from a seeded shuffle of all 72 ordered pairs. The schedule continues across games and reshuffles on exhaustion. The full schedule and pair indices are logged. Every game starts in defense and has a one-second `game_start` animation.

The ghost chooses a stay or uniformly random legal direction only when stationary at a node and a decision bin occurs. Once chosen, it travels to the next node; decision bins while traveling produce no new choice. During offense, the direction along an edge containing Pacman is excluded if Pacman is no farther than the adjacent node, inclusive. Positions beyond that node or off that edge do not censor a direction. The stay probability is unchanged; moving choices are uniform among the remaining directions. Defense does not censor any direction. This is a node-to-node real-time adaptation of Python's cell-to-cell turn-based ghost policy, rather than an identical transition kernel.

`game_start`, `respawn_ready`, `eat_power_pellet`, `eat_ghost`, and `dying` freeze movement and task clocks for the configured animation duration. On contact, the reward uses the current context. Death removes a life. After a nonfatal death or ghost capture, Pacman snaps to the nearest node at the end of the animation, before the ghost respawns uniformly among nodes at sufficient maze distance. During the capture animation, the contact reward appears briefly beside the ghost. Exact midpoint ties use the first node in row-major order. Life loss immediately removes any visible power pellet, with a `pellet_disappeared` event. The context is retained. A new pellet can appear on a subsequent active defense check. After each nonfatal death, a separate `respawn_ready` state displays READY for `transition_duration_s` before gameplay resumes. The last death returns to the menu. Contact does not itself change context.

With pellets disabled, either context can switch geometrically. With pellets enabled, pellet consumption initiates offense, and offense ends geometrically. For a simulation tick with competing events, priority is pellet consumption, then contact, then periodic reward, then context switch. Therefore consuming a pellet on a contact tick protects Pacman during the animation; any continued contact is resolved afterward in offense. Unlike Python's sequential agent/ghost moves, browser entities move simultaneously.

Manual pause freezes the entire simulation, including transition animations, without changing the current simulation state. The simulation also pauses when the tab is hidden, unfocused, or disconnected from the logging server. Paused inputs are logged but discarded. A frame gap above 250 ms is logged and discarded rather than advancing unseen gameplay. Transition time is measured in unpaused simulation time. Rendering follows simulation at 60 Hz, independently of monitor refresh rate.

## Data

The unchanged server writes timestamped `.jsonl` files in `logs/`, using the `subject_id` URL parameter. The logger batches records every 500 ms. At game end and on focus loss/page hide, it also requests a `.json` export containing **all session records so far**, including earlier games. During a session, `downloadSession()` in the browser console downloads an equivalent local JSON backup.

Each record has `type`, `sequence`, `session_id`, `game_id`, `episode_id` (identical to game ID), simulation `tick`, `t_wall` (Unix ms), `t_sketch` (browser monotonic ms), and `payload`. Key events:

- `session_start`: full configuration, seed, schema/task versions.
- `start_schedule`, `game_start`, `game_end`, `session_scores`.
- `game_state`: complete dynamic state every simulation tick, including animation ticks; positions, movement targets/directions, context, score, lives, pellet, timer remainders, and RNG state.
- `key_pressed`, `key_released`, mouse/button events, and `controller_state` (raw axes and analog buttons whenever they change).
- `direction_input`: interpreted request and source; `action`: accepted/rejected status and reason. Rejected animation requests are retained.
- `state_transition`, `context_switch`, `ghost_decision`, `ghost_respawn`, `pacman_snapped`, `pellet_appeared`, `pellet_disappeared`, `contact`, `reward`.
- `pause_toggle`: input source and manual pause setting.
- `task_paused`: `start_wall_ms` and pause cause; `task_resumed`: matching `start_wall_ms`, `end_wall_ms`, and monotonic `duration_s`. Simulation ticks remain frozen throughout each pause.
- `visibility_changed`, `focus_changed`, `timing_gap`, `log_connection`.

Input records contain receipt timestamps; the associated tick is the last completed simulation tick. Accepted inputs affect the next tick. Events within one tick are ordered by `sequence`. Snapshots are written after events from that tick. The initial state is also recorded at game start.

JSONL batch lines have `type: "batch"` and an `events` array. Flatten them before sorting by `sequence` (nonbatched starter records may also occur). Example:

```python
import json
records = []
with open('logs/YOUR_FILE.jsonl') as f:
    for line in f:
        item = json.loads(line)
        records.extend(item['events'] if item.get('type') == 'batch' else [item])
records.sort(key=lambda x: x.get('sequence', -1))
```

The starter creates a new file on reconnection; join these with `session_id` and `sequence`. Its WebSocket protocol has no disk-write acknowledgments, so an abrupt browser/server termination can lose the final in-flight batch. The task pauses during observed disconnects; keep the server running and finish games normally for complete exports. Session records are held in browser memory for the JSON backup, so restart the page between long participant sessions.

## Checks

```sh
node --test tests/*.test.cjs
```

Tests cover topology, all start pairs, geometric timing, mandatory stops, reversals, collision crossing, lives, respawns, pellet transitions, seeded replay, and long-run corridor invariants.

Optional browser/server smoke test (start the server first):

```sh
npm install
npx playwright install chromium
npm run test:browser
```
