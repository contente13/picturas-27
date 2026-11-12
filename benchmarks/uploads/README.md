# P4: upload measurement preparation

Status: the original-version official campaign completed under protocol 4: 50 trials,
90 requests, 40 valid numeric trials and 30 HTTP 504 responses in the large-concurrent
condition. Generated results and the external handoff are under ignored `runs/`;
see `runs/ENTREGA-P3.md` and `runs/BASELINE-P4.md`. No application refactoring was done.
Baseline source: `052310226c51fa57a17101c7bd1ad795674aac95`.

## Frozen decisions

| Condition | Corpus | Concurrent clients | Baseline repetitions | Final repetitions |
| --- | --- | ---: | ---: | ---: |
| Small video | MP4/H.264 + AAC, about 50 MiB | 1 | 10 | 10 |
| Large video | MP4/H.264 + AAC, about 900 MiB | 1 | 10 | 10 |
| Concurrent videos | Same large file in three different projects | 3 | 10 | 10 |
| Image control | Real JPEG, about 5 MiB | 1 | 10 | 10 |
| Concurrent small videos | Same small file in three different projects | 3 | 10 | 10 |

MiB means 1,048,576 bytes. Videos are 1280x720/25 fps; small duration 50 s and large
duration 120 s. All clients use independent Premium test identities, including the small
and image conditions, to keep the profile constant. Corpus generation permits +/-5% video
size and +/-10% JPEG size, then freezes **exact bytes and SHA-256** in its manifest.
The same actual files must be reused after refactoring. Synthetic, constant-rate videos
exercise transfer size; they do not represent all real video content or codecs.

There are 50 measured trials per version, comprising 90 HTTP uploads per version.
Pilot trials are separate, one per condition, and never count towards those totals.

The observation window is 30 s idle, the complete HTTP upload(s), and 30 s after **all**
responses/errors. Upload duration is measured independently per request from the common
barrier release to its complete HTTP response; initial TLS setup is excluded consistently.
This includes nginx, validation, storage and association with the project, **not video editing**.
The socket-send duration is supplementary and is not server receipt time.

## Safety and repeat preparation

Use an isolated Compose project named `picturas-p4-<name>`, with its own automatically
namespaced named volumes. Do not use the normal `picturas` project or delete its volumes.
Check for host-port collisions first: the unmodified Compose file exposes fixed ports.
Only start this stack when those ports are available. No command here wipes existing volumes.
Do not run a second benchmark, editing jobs, or fault-injection tests concurrently.

Before each trial the harness restarts **only** `api_gateway`, `projects` and `img_storage`
in the selected test project. Other services remain running. It checks authentication/readiness,
waits 5 s, creates one fresh empty project per participating client, reads it once, then
starts observers and the 30 s resting window. This is a fixed light HTTP warm-up, not an
upload warm-up. OS/S3 caches are not globally flushed; this is not a cold-cache benchmark.
Use the same preparation/order on both versions and document any different machine workload.

After measurement, stored-object hashes and video metadata are checked, followed by deletion
of each test media through the application API, then its empty project. Trial IDs are retained
in evidence. A failed/uncertain trial stops the session for review; no blind retry replaces it.
If upload fails between object storage and project association, an orphan object may remain:
the harness does not guess keys or delete unrelated data. Diagnose and record it before resuming.

## Commands (PowerShell, repository root)

Prerequisites: Python standard library, Docker Desktop Linux engine, adequate free disk/RAM.
The existing `video_tool` image supplies FFmpeg and Python for corpus generation; they need
not be installed in Windows. Build the approved source before the baseline, preserving
image IDs/digests for final comparison. Do not pull/rebuild dependencies between versions
without documenting the difference. Full image IDs and resource limits are saved by the harness.

```powershell
# First confirm ports are free and no normal installation will be affected.
docker compose -p picturas-p4-baseline up -d --build
python benchmarks/uploads/bench.py preflight --project picturas-p4-baseline

# Generated media, measurements and client tokens are git-ignored.
python benchmarks/uploads/bench.py corpus --project picturas-p4-baseline
python benchmarks/uploads/bench.py setup --project picturas-p4-baseline

# Validate one small condition first, then the other conditions.
python benchmarks/uploads/bench.py run --project picturas-p4-baseline --phase pilot --scenario small
python benchmarks/uploads/bench.py run --project picturas-p4-baseline --phase pilot --scenario large
python benchmarks/uploads/bench.py run --project picturas-p4-baseline --phase pilot --scenario concurrent
python benchmarks/uploads/bench.py run --project picturas-p4-baseline --phase pilot --scenario image

# Run only after the pilot and criteria have been reviewed/frozen.
python benchmarks/uploads/bench.py run --project picturas-p4-baseline --phase baseline
```

Corpus generation alone can reuse an existing Python+FFmpeg image without a running stack:

```powershell
python benchmarks/uploads/bench.py corpus --project picturas-p4-baseline --generator-image picturas-projects:latest
python benchmarks/uploads/check_observer.py --image picturas-projects:latest
python -m unittest discover -s benchmarks/uploads -p 'test_*.py' -v
```

The image used by the standalone corpus/instrument check is **not** claimed as the approved
application baseline. Its ID is recorded; only the generated corpus is reused in actual trials.

`setup` creates three Premium users through the existing local registration API. It saves
tokens only in `clients.local.json`, never in results. Do not commit/share that file.
If tokens expire, obtain renewed tokens for those users or explicitly recreate the isolated
test identities, documenting the change. `--base-url` supports a different localhost HTTPS
port; it must match the isolated test stack and is recorded with client identities.

For the final version, repeat with `--phase final`, the same corpus and unchanged protocol,
machine resources and dependency versions. Record the final implementation commit. Do not
overwrite baseline data. Different test-project names need their own client file via `--clients`.

## Instruments and outputs

The client streams 1 MiB chunks from the Windows host. It does not load entire fixtures into
RAM. Three concurrent requests connect and open files first, then use a shared barrier;
actual start skew and all-uploads completion time are recorded, not assumed zero.

For each observed service, a temporary helper container runs Node from that service's
**exact existing image ID**, with the target's PID namespace, no network, a read-only root
and capabilities dropped except `SYS_PTRACE`, needed to read the target's `/proc/1/root`
for supplementary metrics. The helper is outside the target service cgroup and excludes its
own PID. Every 100 ms it sums `/proc/<pid>/status` VmRSS for all target processes, including
FFprobe and other children. This is **sum of process RSS**, not unique physical memory:
shared pages can be counted more than once. Observer startup/shutdown is outside the window.

Each row records timestamp, read cost, PIDs and RSS. Aggregation uses common 100 ms time
buckets across the three services. Resting RSS is the median of aggregate idle samples;
additional peak is maximum aggregate RSS in the observation window minus that resting median.
Individual RSS data remain available per service. Missing samples never become zero. The
initial strict quality gate rejects missing common buckets or gaps over 250 ms; the pilot
must assess its feasibility before any official measurement. Document a justified protocol
revision if needed, then use the revised version on both builds.

Cgroup v2 memory.current, memory.stat, cpu.stat, io.stat and memory.events (or their v1
controller equivalents, including cpuacct.usage and memory.failcnt) are supplementary,
best effort, read from the target's mount namespace. Raw fields are retained, rather than
calling container memory RSS. If permission/cgroup layout prevents access, absence is explicit.
Container IDs, restart counts and OOM flags are captured before/after. Short-lived processes
between samples and external host load remain limitations.

`runs/<timestamp>-<phase>-<id>/` contains sanitized environment metadata, immutable protocol
and script hashes, per-trial JSONL samples, observer errors and results. No credentials or
presigned URLs are written. Raw samples contain all measured process names and cgroup counters.
Result summaries include memory, individual request durations, concurrency skew, status,
integrity and trial quality. Failed sessions retain their evidence and stop for review.

## Pilot acceptance and remaining preparation

Before calling results a baseline, confirm:

- Docker image IDs and bind-mounted code match the source; capture `docker version`,
  `docker compose version`, OS, CPU model/count, physical RAM, Docker VM RAM/CPU, free disk,
  runtime versions and resource limits. `preflight` captures only part of this inventory.
- Corpus generation finishes; inspect/play both videos and view the JPEG. Archive manifest
  and media externally with the same hashes; generation depends on pinned encoder versions.
- All three RSS readers can access target processes and have acceptable read cost and
  sampling gaps, including the FFprobe subprocess. Check Windows/VM timestamps against the
  host upload timestamps before trusting phase boundaries.
- Compare a small pilot with/without observers, separately from official trials, to assess
  overhead. No overhead claim has yet been demonstrated.
- Raw supplementary CPU/cache/I/O counters are available. The helper also samples visible
  files in the target's `/tmp` every 1 s (logical/allocated bytes, read cost and completeness;
  capped at 10,000 entries). This misses deleted-but-open files and subsecond peaks. Validate
  overhead in the pilot. This is not total stack disk use: observe nginx/S3 and any additional
  temporary locations too if costs move there; no complete disk-cost claim is justified yet.
- Large/concurrent trials fit RAM/disk and finish. If not, retain failure and define an
  additional common feasible condition before refactoring; do not quietly replace agreed sizes.
- Agree the quantitative targets with P3 using baseline evidence, and lock the protocol.

After collecting valid trials, report each condition's individual values, median and spread;
retain failures in counts. Do not compute reduction percentages using failed uploads or
invalid sample windows. The 50% minimum / 70% target and <=10% time overhead are still
candidate criteria requiring justification before implementation. This preparation does not
replace permissions/invalid-media/regression checks or a complete functional requirements audit.

## Source alignment

Reviewed: supplied Phase 2 guidelines v1, PL1-G4 report (baseline description and stated
implementation limits), current root README/AGENTS, upload producers/consumers and video
validation. Phase 2 requires quantitative before/after evaluation and preserved functionality.
No application contract, limit, permission or use case is changed by these benchmark files.
The current checkout has no `use-cases/` directory; do not rely on the superseded local cases.

Instrument references:

- https://docs.docker.com/engine/containers/run/ (PID namespace sharing)
- https://docs.docker.com/engine/containers/runmetrics/ (cgroups and resource metrics)
- https://docs.docker.com/reference/cli/docker/container/stats/ (CLI memory differs from raw usage/cache)

## Local pilot protocol revision 2

The Linux small-video pilot completed with HTTP 204 and matching stored hash and
metadata, but its memory window was invalid: 7 missing common buckets despite individual
maximum gaps of 105–110 ms. Independent relative timers drift across fixed epoch buckets.
Protocol 2 schedules each observer at the midpoint of the same epoch-aligned 100 ms
buckets. It does not interpolate, backfill, or relax the zero-missing-bucket / 250 ms gap
criteria. Read cost now includes supplementary cgroup reads. Preserve the protocol-1
pilot as invalid; rerun pilots and use protocol 2 unchanged for baseline and final.

## Official campaign protocol 4

The user confirmed five scenarios: the original four plus `concurrent_small` (three
clients with the same frozen small video). The original large concurrent condition is
retained, with a final-version goal of completing without timeout under unchanged
resources/timeouts. There are 50 numbered trials / 90 requests per version, ten trials
per scenario. Pilots remain separate. Order: small, large, image, concurrent_small,
concurrent; use the same order on the final version. Protocols 1–3 remain historical
evidence, not current campaign specifications.

The harness atomically checkpoints every completed response and window boundaries
before observer shutdown. All helper cleanup is attempted, with forced removal only
for helpers it created; the application is untouched. A read-only storage-prefix audit
follows API cleanup, outside the measurement window. Observer labels cannot be confused
with the application Compose project.

`--continue-reviewed-concurrent` permits counting the already reviewed large-concurrent
HTTP 504 and sampling failures without replacing attempts, after stable-service and
project/object cleanup checks. Instrument, integrity, service or unresolved cleanup
failures still stop the session. Failed/invalid trials remain in all counts and never
contribute to accepted memory reduction statistics. The same policy must be used for
the final campaign.

```bash
python3 benchmarks/uploads/bench.py run --project picturas-p4-baseline --phase baseline --continue-reviewed-concurrent
```

## Known limitation found in the official campaign

Immediate per-trial cleanup checks returned zero, but the final global audit found 12
objects under removed test projects from failed concurrent trials 4, 7, 9 and 10.
Their exact keys/HEADs were retained; only those discovered P4 keys were removed after
ending pending activity, and a final audit confirmed zero test projects/objects.
Do not claim quiescent empty storage between those failed trials or infer unique memory
causality. The numeric comparison scenarios preceded the failed concurrent block.
Always perform a global post-campaign audit outside the measurement windows; an immediate
check following HTTP 504 does not prove that the backend has stopped or storage will
remain empty. Application cancellation/cleanup is a P3 implementation concern.

A reviewed asynchronous helper-removal check caused a pause at `small-09`; original
results were retained and reviewed, then resumed at `small-10` without replacing trials.
Resume metadata and both harness snapshots identify the post-window control change.
Eight local checks passed; six real helper-stop CLI timeouts were recovered without
losing request outcomes in the official campaign.
