# RNF-EFIC-01: upload refactoring and evaluation

Both official campaigns completed under protocol 4: **50 trials / 90 requests per version**.
The final campaign completed all 90 uploads with HTTP 204, version and stored-object integrity
verified. The main condition achieved a **86.10% memory reduction**
and a **-13.04% response-time change**. All ten large-concurrent trials
completed their three uploads. Results and external deliverables are under ignored `runs/`.

Baseline source: `052310226c51fa57a17101c7bd1ad795674aac95`.
Evaluated final snapshot: `b1b37f562d3c6eb80556caea89254e829c22d97e`.

## Acceptance criteria

`acceptance.json` specifies the team's RNF-EFIC-01 criteria. The common comparison condition
is three independent Premium clients, each uploading the same frozen small video into a
fresh project. Reduce the median additional aggregate process RSS by at least **50%**, with a
**70% target**. Permit at most **15%** increase in the median time until all responses, with a
target of no increase. Preserve bytes, metadata, version and one association per file.

The baseline response-time median is 1.4769637451171875 s, so the maximum final median is
`baseline * 1.15` = **1.6985083068847655 s**. The measured final median is
1.284436523437 s, and the memory median is
135.93945312 MiB. Full precision, spreads and decisions are retained in JSON.

The additional goal is to complete all three large concurrent uploads in every one of ten
trials with HTTP 204, version and integrity, without increasing resources or request timeouts.
There is no eligible large-concurrent memory baseline, so no memory-reduction percentage is
calculated for that condition.

## Corpus and scenarios

| Condition | Frozen file | Clients | Repetitions per version |
| --- | --- | ---: | ---: |
| Small video | 53,243,813-byte MP4/H.264 + AAC, about 50 MiB | 1 | 10 |
| Large video | 942,219,473-byte MP4/H.264 + AAC, about 900 MiB | 1 | 10 |
| Image | 5,263,900-byte JPEG, about 5 MiB | 1 | 10 |
| Concurrent small videos | Same small video, distinct projects | 3 | 10 |
| Concurrent large videos | Same large video, distinct projects | 3 | 10 |

MiB means 1,048,576 bytes. Videos are 1280x720/25 fps, with durations of 50 s and 120 s.
The exact bytes and SHA-256 are frozen in the corpus manifest and reused across versions.
Synthetic constant-rate videos exercise transfer size, not every real codec or content type.
Every performance client is Premium, including the small-video and image controls.

## Upload architecture

- Nginx forwards the request body with HTTP/1.1 and `proxy_request_buffering off`.
- The gateway authenticates and forwards the original multipart stream with backpressure,
  preserving owner/share context, identity, MIME, filename and project-version headers.
- Projects receives a restricted temporary file, validates video through FFprobe, computes
  SHA-256 incrementally and streams it to storage. Storage also uses a temporary file.
- Accepted files up to 1 GiB use one streaming S3 PUT. Larger internal generated outputs
  retain bounded multipart support. Redirect replay buffering is disabled on internal uploads.
- `seaweedfs/master.toml` runs regular compaction to reclaim deleted data and keep volume
  slots writable. Capacity, volume-growth rules, replication and request timeouts are preserved.
- Cancellation closes streams and cleans temporary files. Known unassociated objects are
  compensated; uncertain database commits retain their objects to avoid broken references.

## Measurement protocol

Order: small, large, image, concurrent small, concurrent large. Ten numbered attempts per
condition; failed attempts are retained and never replaced. Pilots and directed functional
stress tests are separate and do not count towards official medians or repetitions.

Before each trial, restart only `api_gateway`, `projects` and `img_storage` in the isolated
stack, check authentication/readiness, wait 5 s and create/read fresh empty projects. This is
light HTTP warm-up, not upload warm-up. Caches are not globally flushed. Do not run another
benchmark, editing job or fault injection concurrently.

The window is 30 s idle, the full HTTP uploads and 30 s after all responses/errors. The client
streams 1 MiB chunks, opens files/connects TLS first and releases concurrent requests through
a barrier. Duration runs from that barrier to the complete response, including validation,
storage and association, not video editing. Socket-send duration is only supplementary.

External helper containers use each target's exact image and PID namespace, read-only roots,
no network and only `SYS_PTRACE` beyond dropped capabilities. They are outside target cgroups
and exclude their own PID. Every 100 ms, they sum process VmRSS, including children such as
FFprobe. Aggregation uses common epoch-aligned buckets; individual service peaks are not added.
Additional peak is maximum aggregate RSS minus median aggregate idle RSS.

Accept a memory window only with zero missing common buckets and gaps no greater than
250 ms. Missing data never become zero. Upload integrity and sampling quality are separate:
a successful large upload with an invalid RSS window is excluded from memory statistics.
`--continue-reviewed-concurrent` retains reviewed large-concurrent sampling/504 outcomes only
after stability and cleanup checks; unresolved integrity/service/instrument/cleanup failures stop
for review. This policy is the same on both versions.

After the window, download and hash each stored object, verify metadata and association,
then delete media and projects through the API. Audit known storage prefixes. Finally perform
a global audit after quiescence, including multipart uploads and temporary directories.

## Reproduction

Use an isolated `picturas-p4-<name>` Compose project and its own volumes; never the normal
`picturas` project. Pin the recorded images and use a clean source snapshot. The archived
`instrument/compose.p4-final.yaml` shows the evaluated override, with unused host ports reset.
Keep runtimes, installed dependency locks, machine resources, limits and timeouts consistent.
The final images preserve frozen base layers and copy application code without installing
packages or pulling floating base images. Check readiness and effective source before measuring.

From the prepared test checkout, with its pinned override and exact corpus:

```bash
python3 benchmarks/uploads/bench.py preflight --project picturas-p4-final
# Once per isolated test instance; never overwrite existing client identities.
python3 benchmarks/uploads/bench.py setup --project picturas-p4-final
python3 benchmarks/uploads/bench.py run --project picturas-p4-final --phase pilot --scenario concurrent
python3 benchmarks/uploads/bench.py run --project picturas-p4-final --phase final --continue-reviewed-concurrent
```

`setup` saves three Premium test identities only in ignored `clients.local.json`. Existing
instances reuse their own client file; `--clients` selects another file whose project/base URL
must match. Keep tokens out of reports and commits. For another machine, collect its own
comparable baseline and final results using the same local corpus, software and resources.

The harness uses Python's standard library. Instrument checks can be run outside campaigns:

```bash
python3 -m unittest discover -s benchmarks/uploads -p 'test_*.py' -v
python3 benchmarks/uploads/check_observer.py --image <recorded-node-image>
```

## Evidence and limits

Current report: `runs/stream-review/RELATORIO-RNF-EFIC-01.md`. Full summaries, per-trial and
per-request CSVs, unit/integration logs, runtime checks and final audit are alongside it.
`runs/p4-final-evaluation.zip` contains the external evidence with SHA256SUMS and an external
ZIP checksum. Exact media are provided separately in `runs/p4-upload-corpus.zip`; Docker
images and credentials are excluded. Never commit generated media, results, secrets or caches.

Raw samples retain process RSS and supplementary cgroup memory/cache, CPU, I/O, OOM and
1 s temporary-file statistics. RSS is not unique physical memory; shared pages can be counted
more than once, and brief peaks/processes between samples can be missed. Temporary-file
statistics miss deleted-but-open files and subsecond peaks and do not measure total stack disk
cost. No complete system-wide CPU, physical-memory or disk-cost claim is made.

The original large-concurrent block had late objects after immediate cleanup checks; its raw
evidence and exact-key recovery are retained in the baseline package. The four numeric baseline
blocks preceded it. A post-campaign global audit is required; an immediate check after a timeout
does not prove all pending activity has ended. Final claims apply to the recorded corpus,
source and environment, not every machine, codec or workload. Automated/API/storage checks do
not constitute a manual full-interface or all-worker end-to-end regression. Abrupt process death
can bypass temporary cleanup, and no distributed transaction or universal no-orphan guarantee
has been introduced.
