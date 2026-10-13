# Veritas Rewrite v3.1 — Render deployment changes

Prepared 13 October 2026. App version **3.1.0**. **87 automated tests passed; 0 failed** (`npm test`). This includes the 77 existing application tests and 10 hosted-deployment checks: explicit hosted configuration, HTTPS origins and password requirements, unauthenticated API rejection, credential handling, exact Host/Origin validation, independent liveness, startup request gating, failed startup, hosted privacy copy, and persistent cache paths.

Added a Dockerfile using Node 22 and the official Ollama 0.32.14 image, runtime model setup, persistent cache configuration, and a deployment guide. Docker/Podman are unavailable here, so no Docker build or actual Render deployment was executed. Real Ollama generation, Render memory needs and CPU latency remain unverified. The 8 GB recommendation is an initial sizing estimate.

A separate startup smoke check launched the real Render supervisor with a simulated Ollama metadata service and the real cached pinned classifier. It reached model readiness, rejected requests without credentials, answered liveness probes and shut down cleanly on SIGTERM. This did not generate text or run Docker. Current static checks verified 81 unique HTML IDs, 72 literal app references, 11 explicit label targets, and syntax for all 28 JavaScript files.

The historical v3 classifier evidence below remains unchanged. The detector identity and scoring formula did not change in v3.1.

---

# Veritas Rewrite v3 — validation report

Prepared 12 October 2026. App version **3.0.0**. Environment: Linux x86_64, Node.js v24.19.0.

## Executed checks

**77 automated tests passed; 0 failed.** Command: `node --test`.

The suite uses real local HTTP requests and controlled generation/scoring responses to exercise the API, with separately executed real detector checks below. The target figures in deterministic fixtures are injected values, not claims about actual rewrite quality.

| Area | Verified behavior |
| --- | --- |
| Draft/output limit | Exactly 300 words accepted; 301 rejected before inference; no silent truncation |
| Editorial checks | Quotes, numbers, citations, URLs and protected terms; unchanged wording and duplicate candidates; bounded generation retries |
| Local model review | Meaning/fluency failures excluded; invalid or incomplete reviews fail closed |
| Target input | Integer 5–80; minimum 100 scanner words; unsupported-script and short drafts rejected before inference |
| Target search | Later-round success; best score retained; three-round bound; explicit unmet/already-met states |
| Reported regression | Injected 98.0 → 98.1 keeps the original, without manufacturing a decrease |
| Strict comparison | Exactly 20% fails a below-20% goal; rounding does not control success |
| Comparable scoring | Wrong revision, dtype, runtime library version, partial coverage, fallback, invalid/missing scores all rejected |
| Length shortcut | Rewrites below 100 scanner words are excluded from scoring/selection |
| Failure/cancellation | Missing detector, scorer failure, timeout and subprocess cancellation; no synthetic score |
| Full target HTTP flow | Actual generation/review pipeline with mocked local models returns original and candidate measurements |
| Scoring contract | 448-token windows, 384-token stride, AI label, and overlap-adjusted weighting |
| UI presentation logic | Selected candidate recomputes target status; raw-below-threshold rounding handled |
| Existing API protections | Local Host/Origin, path allowlist, request size, concurrency, cloud alias rejection, local-only HTTP transport |
| Scanner report comparison | Exact-passage and full-coverage checks; no comparing different models/revisions/fallback paths |

## Real pinned classifier checks

The actual `@huggingface/transformers` **3.8.1** runtime and pinned q8 ONNX model were installed for these checks. The setup script loaded the model, scored a synthetic passage, and then launched a separate detector process with remote downloads disabled. That offline scoring check passed.

The new scoring implementation was compared against the saved Veritas Scanner 3.1.0 implementation on the **same downloaded weights, revision, text and CPU runtime**:

| Synthetic passage | Words | Tokens / windows | Saved scanner score | New backend score | Difference |
| --- | ---: | --- | ---: | ---: | ---: |
| Workshop records | 107 | 116 / 1 | 97.61274456977844% | 97.61274456977844% | 0 |
| Repeated technical wording | 300 | 641 / 2 | 98.10008442904016% | 98.10008442904016% | 0 |

Window boundaries, fragment text and chunk scores also matched exactly. Raw results are in `examples/detector-parity-results.json`.

These are **detector parity tests**, not human-vs-AI accuracy benchmarks or before-and-after rewrite evaluations. The second sample intentionally exercises overlapping windows. Neither passage was the user's reported 98%/98.1% passage. Browser WASM parity and differences across other detectors were not measured.

A native ONNX reload failure was found when using terminated Node worker threads. The implementation was changed to a separate child process, after which fresh-process offline setup and parity checks passed. Cancellation now terminates that process; subsequent scoring starts a new process.

## Frontend and packaging checks

Static structure verified **77 unique element IDs**, **67 literal JavaScript ID references**, **11 explicit label targets**, and all three linked assets. Syntax checks passed for all **26 JavaScript files**. Existing HTTP tests verify served assets and CSP; the new target module is served on the same origin. User/model text is rendered as text nodes, not injected HTML.

The ZIP includes source, pinned package metadata/lockfile, setup launchers, examples and tests. It excludes downloaded models, installed dependencies, local configuration, temporary logs and test caches. Windows launchers use CRLF line endings.

## Not established by these checks

- **Live Ollama generation and target attainment:** no live Ollama rewriting run was completed here. The multi-round orchestration was tested with controlled model outputs. Naturalness, meaning preservation, latency, and reaching below 20% on the user's passage remain unverified.
- **Independent semantic validation:** review is a second call to the same writing model. Exact anchor checks plus that review can still miss meaning changes.
- **Browser visual/interaction QA:** static structure, module syntax and shared presentation logic were checked, but a real-browser pass was not performed.
- **Windows execution:** setup and launch batch files were prepared for Windows but not executed there.
- **Plagiarism reduction:** no external corpus benchmark was run. The optional reference check is exact phrase overlap, not a plagiarism percentage.

## Reproduce on the target laptop

1. Run `SETUP_WINDOWS.bat` if Ollama needs setup, then `SETUP_TARGET_WINDOWS.bat` for the classifier.
2. Run `node scripts/doctor.js`; expect the writing model ready and the detector installed.
3. Save a 100–300-word English input in `passage.txt`.
4. Run `node scripts/evaluate-target.js passage.txt 20`. Inspect the generated `target-evaluation-results.json` and complete its human-review fields.
5. Run the app and check the same passage, slider, candidate selection, meters, history, cancellation, copy/download and report export.
6. Recheck exact original/rewrite text in Veritas Scanner. Export and compare reports only when both runs use the same full model and revision.

A lower detector score does not prove authorship or originality. The app reports the actual classifier results and explicitly reports an unmet target.
