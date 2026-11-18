# RNF-FIAB-01: fault-injection harness

Measures whether image-processing jobs survive the failure of a worker (or of the
orchestrator) and finish without lost jobs, duplicated results, re-applied effects or
altered originals. The same protocol runs on the baseline and on the refactored version.

Measured versions: baseline `df5d0bc` (`main`) and final `cab1b35` (branch `rnf-fiab-01`).
`protocol.json` still names `0523102` as `baseline_commit` (the protocol predates `df5d0bc`); the
commit actually measured is recorded in each campaign's `environment.json`. Results and analysis:
`RELATORIO-RNF-FIAB-01.md`.

## How faults are injected

The application is **not modified**. `compose.fiab.yaml` (test-only override) mounts:

- `faultshim/sitecustomize.py` into `brightness_tool`, `rotate_tool` and `border_tool`
  through `PYTHONPATH`. It wraps `pika` consume/publish and `PIL.Image.Image.save`.
- `faultshim/node/fault-shim.js` into `projects` through `NODE_OPTIONS=--require`. It wraps
  `Process.create` (successor steps), `Result.create` and `Project.commitRunIfActive` and, when
  the module exists, `utils/runJobs.js` (`mongoStore().transition` and `upsertResult`).

Both shims are inert unless armed. The harness writes `runs/ctl/arm-<service>.json` and the
fault fires on the *n*th message after it appears. The arm file is renamed to `*.fired.json`
before acting, so a restarted process is not re-armed. Crashes exit without cleanup, and Compose
restarts the container (`restart: on-failure`). Every receive, consumer registration, reply
and fault is traced to `runs/ctl/events-<service>.jsonl`. That trace proves *when* the fault
happened: the harness never relies on random delays.

If the refactoring renames the wrapped functions, the shims must be adapted **without changing
the fault points**. Record any such change in the final report.

The shims were adapted once, for the refactored version (`cab1b35`), and the new shims were
checked on the baseline before the final campaign (`runs/equiv-shims-df5d0bc/`: same outcome
per scenario). The current request is kept per process, not per thread, because the refactored
workers run the effect on a handler thread and publish from the connection thread.

| Point | Baseline (`df5d0bc`) | Refactored (`cab1b35`) |
| --- | --- | --- |
| `after_receive` | consumer callback entered | same (before the handler thread starts) |
| `during_write` | `Image.save` of the step output, truncated | `Image.save` of the `.tmp` file, before `os.replace` |
| `after_write` | after `Image.save` returns | after the `.tmp` save (output not yet renamed or replied) |
| `after_publish` / `before_publish` | around `basic_publish` to `project_queue` in the callback | the same call, now made on the connection thread before the ACK |
| `before_successor_create` | `Process.create` with `cur_pos >= 1`, after the old `Process` was deleted (P4) | after `transition()` resolves with `state: PENDING_DISPATCH`, `cur_pos >= 1`: next step persisted, not yet published (P5/P6) |
| `before_result_create` | `Result.create` | `Result.create` or `upsertResult` |
| `before_commit` | `Project.commitRunIfActive` | same |

## Lot and pipeline

Ten deterministic, non-square 320x240 PNGs (`fiab.py corpus`, SHA-256 in
`runs/corpus/manifest.json`), processed by `brightness 1.3 -> rotate 90 -> border 8 px`.
From the second step on, each step reads and writes the same file. A re-applied rotate or
border therefore changes the output dimensions. Outputs are compared with the golden SHA-256
frozen from the first R0 trial of the `baseline` phase (pilots never freeze it) (`runs/golden.json`).

## Scenarios

| ID | Fault (target: 5th rotate job unless stated) |
| --- | --- |
| R0 | none (reference duration, quota and result count) |
| R1 | worker dies after receiving the request, before any output |
| R2 | worker dies while writing the output (truncated file left behind) |
| R3 | worker dies after writing the output, before replying |
| R4 | worker dies 1 s after publishing the reply, before acknowledging the request |
| R5a / R5b | the reply is delivered twice, at once / 2 s apart |
| R6a / R6b / R6c | `projects` dies before registering a successor step / before persisting a final result / before committing the run |
| R7a / R7b | first rotate job held at reply / at write. The run is cancelled and restarted, then the held job is released into the new run |
| R8 | permanent error (invalid brightness parameter): no endless retries, error surfaced |

The defaults are 10 repetitions per scenario, a 120 s window after `POST /process` and a 30 s
late check whenever a fault was armed or the run did not finish. Failed trials stay in the
denominator, and no trial is ever repeated or replaced (`run` skips recorded trials).

Per trial (`runs/<campaign>/<trial>/trial.json`): completion, duration, lost files, duplicated
results (same file twice for the run token), output mismatches against the golden, altered
originals, pending `Process` records, deliveries per message, fault -> worker ready -> resume
times, and the daily-operations delta. Also kept: the shim traces and the logs of `projects`
and of the three workers. `summarize` writes `trials.csv` and `summary.json`.

Reset between trials: the trace and arm files are cleared, the tool queues and `project_queue`
are purged, the harness waits until every queue has a consumer, and then uses a fresh free user
and a fresh project. The project is deleted afterwards, and users accumulate in the isolated stack.

## Commands (bash, repository root)

Prerequisites: Docker Engine with Compose >= 2.24 (`!reset`), Python 3 standard library.
The test stack listens on https://localhost:8443, so a normal stack on 8080 can keep running.

```bash
H=benchmarks/fault-tolerance
git worktree add ../picturas-fiab-baseline df5d0bc               # once (final: origin/rnf-fiab-01)
python3 $H/fiab.py corpus                                            # once; never regenerate
python3 $H/fiab.py up --source ../picturas-fiab-baseline --build     # first time: long build
python3 $H/fiab.py preflight --source ../picturas-fiab-baseline
python3 $H/fiab.py run --source ../picturas-fiab-baseline --phase pilot --scenarios R0,R1 --reps 1
python3 $H/fiab.py run --source ../picturas-fiab-baseline --phase baseline
python3 $H/fiab.py summarize <campaign-folder>
python3 $H/fiab.py down --source ../picturas-fiab-baseline           # stop only, keeps volumes
```

A full campaign is 13 scenarios x 10 repetitions: about 4.5 hours on the baseline (failed lots wait
the whole window plus the late check) and 1.5 hours on the refactored version. Use `--campaign <name>`
to resume an interrupted campaign without repeating trials. For the final measurement, point
`--source` at the refactored tree, rebuild with `up --build`, and keep the same corpus,
`golden.json`, protocol and machine.

Harness self-tests (no Docker): `python -m pytest -q $H/test_fiab.py` (needs `pika`, `pillow`).

## Limitations

- Readiness and resumption come from the shim traces (millisecond wall-clock timestamps), so a
  host clock correction (seen under WSL2) can distort them. Durations use `time.monotonic()`
  since the final campaign. Completion is polled through the API every 0.25 s.
- The duplicate action publishes copies one after another (sequential, P2). Concurrent copies
  (P3) and forced races (P8) are not injected.
- The `projects` restart time includes the `npm` start-up. `ready_to_resume` is only defined for
  worker faults whose message is delivered again.
- The watermark tool is a pre-built external image and is not instrumented.
- Synthetic images exercise the processing chain, not real photo content.
