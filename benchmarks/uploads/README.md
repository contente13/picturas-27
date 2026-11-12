# P4: upload measurement preparation

Status: tooling prepared; **no official baseline has been collected**. The pilot must validate
the corpus, resource budget and observer before the baseline starts. These tools do not
change the application or add a product service. Baseline source: `052310226c51fa57a17101c7bd1ad795674aac95`.

## Frozen decisions

| Condition | Corpus | Concurrent clients | Baseline repetitions | Final repetitions |
| --- | --- | ---: | ---: | ---: |
| Small video | MP4/H.264 + AAC, about 50 MiB | 1 | 10 | 10 |
| Large video | MP4/H.264 + AAC, about 900 MiB | 1 | 10 | 10 |
| Concurrent videos | Same large file in three different projects | 3 | 10 | 10 |
| Image control | Real JPEG, about 5 MiB | 1 | 10 | 10 |

MiB means 1,048,576 bytes. Videos are 1280x720/25 fps; small duration 50 s and large
duration 120 s. All clients use independent Premium test identities, including the small
and image conditions, to keep the profile constant. Corpus generation permits +/-5% video
size and +/-10% JPEG size, then freezes **exact bytes and SHA-256** in its manifest.
The same actual files must be reused after refactoring. Synthetic, constant-rate videos
exercise transfer size; they do not represent all real video content or codecs.

There are 40 measured trials per version, comprising 60 HTTP uploads per version.
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
