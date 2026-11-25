# Upload benchmark results

Both official RNF-EFIC-01 campaigns used protocol 4. Each campaign recorded 50
trials and 90 upload requests.

| Campaign | Summary | Trial data | Request data |
| --- | --- | --- | --- |
| Baseline (`052310226c51fa57a17101c7bd1ad795674aac95`) | [Report](BASELINE-P4.md) · [Status](BASELINE-STATUS.json) | [CSV](baseline-trials.csv) | [CSV](baseline-requests.csv) |
| Final (`c7e597a2674a74f6fc0f225145e74260ff23a61e` on `main`) | [Report](stream-review/RELATORIO-RNF-EFIC-01.md) · [Summary](stream-review/FINAL-P4.md) · [Status](stream-review/FINAL-STATUS.json) | [CSV](stream-review/final-trials.csv) | [CSV](stream-review/final-requests.csv) |

See the saved [analysis checks](stream-review/analysis-verification.json),
[runtime checks](stream-review/runtime-equivalence.json),
[source hashes](stream-review/source-files-sha256.json) and
[service test results](stream-review/test-results.json).

The CSVs retain the original evidence paths. Raw samples and logs are available
in the separately stored `p4-baseline.zip` and `p4-final-evaluation.zip` packages.
