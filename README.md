# Veritas Rewrite v3.1

A self-hosted, **300-word** writing editor with its own Node.js backend, local Ollama rewriting, and a local copy of the pinned Veritas AI classifier. Version 3 adds an adjustable **AI-signal target**, a measured rewrite loop, before/after meters, and an attempt history.

The slider is a **search goal**. Choosing “below 20%” asks the application to try to find an acceptable rewrite whose measured Veritas AI-class score is below 20%. It does not choose how many words are written by AI, alter the detector's scoring formula, or promise that the goal will be reached. No changes are made to the original Veritas Scanner project.

## Render deployment

Version 3.1 adds a Docker launcher for Render, a persistent model cache, password protection, startup progress, and public Host/Origin validation. Follow **[DEPLOY_RENDER.md](DEPLOY_RENDER.md)**. This uses a paid service and persistent disk; start with an 8 GB RAM estimate and monitor usage. The container has not been built or deployed to Render in this development environment.

Local Windows operation still uses the instructions below. In hosted mode, drafts are sent to your Render server over HTTPS.

## Windows setup or upgrade

1. Stop the old Rewrite server with Ctrl+C and extract this ZIP to a new folder, such as `D:\Veritas-Rewrite-v3`. Do not run launchers inside the ZIP preview.
2. Keep your existing Node.js 22+ and Ollama installations. For a first installation, use [Node.js](https://nodejs.org/) and [Ollama](https://ollama.com/download).
3. Run `SETUP_WINDOWS.bat` if the writing model needs setup. An existing `llama3.2:latest` download is reused.
4. **Run `SETUP_TARGET_WINDOWS.bat` once.** This installs the pinned Transformers.js runtime and downloads the pinned q8 classifier. It also verifies a new offline detector process. Internet is needed for setup only.
5. Run `START_WINDOWS.bat`, then open **http://127.0.0.1:8788**. Keep the terminal open. The footer should say **v3.1**.
6. Keep the target enabled, choose **Below 20%**, and paste an English draft of **100–300 words**. Select **Deep rewrite** and **Fresh structure** for a fuller revision. A short sample of your own writing can guide tone.
7. Click **Refine my words**. Review the actual scores, target status, wording, and citations. Use Copy, Download .txt, or Download comparison JSON.

The target detector has a separate setup because it is a different model from the writing model. Model weights and installed runtime packages are not bundled in this ZIP. The default writing model download is about 2 GB. The optional `SETUP_LARGER_MODEL_WINDOWS.bat` downloads and selects `qwen2.5:7b` (about 4.7 GB); this needs more memory and is not a proven fix for detector scores.

If you used a custom writing model or port in v2, copy your `settings.json` into the new folder before starting. Do not copy old application source files over v3. The original Scanner and its settings remain separate.

For macOS/Linux or terminal setup:

```sh
node scripts/setup.js
npm install --no-audit --no-fund
node scripts/setup-detector.js
node server.js --open
```

Normal rewriting, with target mode turned off, still works without installing the detector dependency. It accepts 1–300 words. Target mode requires at least 100 words using the scanner's counting rule; it never substitutes the short-text heuristic. Input and output always retain the editor's 300-word maximum.

## What the target loop does

1. Validate the input, target, protected terms, and word limits.
2. Measure the original with the pinned local classifier. If it is already below the target, return it explicitly as **Original (unchanged)** without generation.
3. Generate distinct alternatives. Deep mode allows four generation attempts for up to three candidates per round; Quick mode allows two attempts for one candidate per round.
4. Reject invalid length, hidden characters, changed numeric strings, detected quotes/citations/URLs, changed protected terms, insufficient edits, and duplicate candidates.
5. Ask the same local writing model, in a second call, to check each candidate's meaning and fluency against the **original**. Only candidates with meaning preserved, no listed issues, and naturalness/fluency ratings of at least 3/5 proceed. This is a fallible model review, not independent proof of factual accuracy.
6. Measure each accepted eligible candidate with the detector. Never count a switch to a fallback, an incomplete check, or a model/version change as an improvement.
7. Keep the lowest measured score, including the original as a baseline. If needed, use the best candidate and measured feedback to guide another round, still reviewing against the original. Stop after success or **three rounds**.
8. If no candidate reaches the goal, display **Target not reached** with the best measured version. If all rewrites are worse or fail checks, retain the original. Scores are not rounded before target comparison: exactly 20% does not satisfy “below 20%.”

A Deep run can use at most 12 generation calls, three review calls, and ten detector checks. Quick uses at most six generation calls, three review calls, and four detector checks. Failed checks and duplicate outputs can reduce those numbers. Invalid review responses or detector/runtime failures produce an error, never a fabricated low score. There is no unlimited retry loop.

The result view lets you choose another candidate and recomputes the target status for that selection. Before/after meters show measured scores. The attempt table includes scored versions and excluded candidates/rounds. Imported Scanner reports remain a separate cross-check.

## Matching the saved Veritas scanner

The inspected scanner is **Veritas Scanner 3.1.0**. Its full-model scoring contract is reproduced here:

| Setting | Value |
| --- | --- |
| Model | `onnx-community/tmr-ai-text-detector-ONNX` |
| Revision | `b9aa251e5bcda7e429fcc936767d921435945b60` |
| Transformers.js | `3.8.1` |
| Quantization | `q8` |
| Window / stride | 448 / 384 tokens |
| Classification | `top_k: 2`, class label `AI` |
| Aggregation | New-token-weighted mean; overlap is not counted twice |
| Minimum input | 100 scanner-counted words, English-focused |
| Rewrite runtime | Node.js / ONNX CPU, separate local process |

The saved scanner's browser uses WASM; this backend uses CPU. Small numerical differences are possible. Your deployed scanner may have a different version, model, or fallback state. Compare exact text and model metadata before expecting agreement. A low score from one classifier does not establish authorship or guarantee a low score on other websites.

Real offline scoring and CPU-to-CPU parity with the saved scanner were tested on two synthetic passages, including 300 words spanning two windows. See `TEST_REPORT.md` and `examples/detector-parity-results.json`. These checks validate the detector integration; they are not evidence that a rewrite reaches below 20%.

## Local operation and privacy

In default local mode, the custom backend binds only to `127.0.0.1`. Render mode explicitly binds to `0.0.0.0:$PORT` and requires a password; both model engines still run privately inside the same server. Ollama calls go directly to `127.0.0.1:11434`, bypass environment proxies, and do not follow redirects. Before generation, the adapter requires local GGUF text-model metadata and rejects cloud-backed aliases. Models are pretrained third-party models running locally; this project does not claim to have trained new model weights.

Detector runtime loading uses `allowRemoteModels=false` and `local_files_only=true`. Only the explicit setup script enables model downloads. Drafts are never sent to Hugging Face or a cloud detection API. Detector inference runs in a separate process, so cancellation and timeouts can terminate native inference without blocking the web server. One rewrite job runs at a time.

There is no draft history, text logging, analytics, remote font, or remote script. Downloading a comparison report explicitly saves the text and measured metadata. Ollama manages its own in-memory model state; the app does not change a pre-existing Ollama service's global settings. Setup starts a new Ollama instance with `OLLAMA_NO_CLOUD=1` when it needs to start one.

## Writing features and limits

- Natural, Academic and Simple tones; Light touch, Balanced and Fresh structure revision levels.
- Optional personal voice sample: at most 120 words, used only for style. Facts from the sample should not leak into the draft.
- Optional reference excerpt: at most 300 words, used only for literal source comparison and never passed to generation.
- Exact retention of detected numeric strings, quotes, citations, URLs and up to 20 protected terms, including occurrence counts. These heuristic checks do not cover every name, fact, formula or meaning change.
- Plain-text import, change highlighting, candidate selection, copy/download, live progress, cancellation and diagnostics.
- A shared 300-word limit counts Unicode letter/number groups; internal apostrophes, hyphens, decimals and comma-separated number groups stay together. The scanner's separate word count splits hyphens, matching its existing minimum-length gate.
- A 12,000-character ceiling and hidden-control-character rejection apply. No output is silently truncated to fit.

**Wording changed** measures word-sequence edits. **Source phrase overlap** measures words in literal five-word matches with the supplied excerpt. Neither is a plagiarism score. Borrowed ideas still need attribution, and rephrasing does not establish originality. This version does not search the web, import PDF/DOCX, or run the scanner's plagiarism engine.

## Configuration and API

Copy `settings.example.json` to `settings.json` to change the port, installed writing model or generation timeout; restart afterward. Environment variables `VERITAS_PORT`, `VERITAS_MODEL` and `VERITAS_TIMEOUT` override those fields. The detector identity and three-round ceiling are pinned in code.

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | HTTP process liveness; does not imply model readiness |
| `GET /api/status` | Writing-model readiness, detector installation, app version, busy flag and limit |
| `GET /api/progress` | Current stage/round and a progress message; no submitted text |
| `POST /api/rewrite` | Validated normal or target-mode rewrite |

Example normal-mode request:

```json
{
  "text": "The CNN model was evaluated using 50 recordings.",
  "tone": "natural",
  "strength": "balanced",
  "quality": "deep",
  "voiceSample": "",
  "protectedTerms": ["CNN"],
  "reference": "",
  "targetPercent": null
}
```

For target mode, provide a 100–300-word English draft and an integer `targetPercent` from **5 to 80**. Omitting it or using `null` retains normal mode. Arbitrary feedback, detector names and model paths supplied by the browser are ignored by input validation.

Normal results contain `text`, `report`, `alternatives`, `selectedId`, `model`, options and generation/review counts. Target results additionally contain per-alternative `ai` measurements, `kind` (`original` or `rewrite`), and a `target` search result with the original/best measurements, requested percentage, raw-score comparison, stop status, round history and detector identity. There can be up to nine reviewed rewrites plus the original. Original-only results have `report.editing=null`, with no invented review ratings. `failedRounds` counts quality-failed batches separately; generation/review counts refer to successfully completed batches.

Errors return `{ "error": { "code": "...", "message": "..." } }`. Missing models/detector packages return 503; timeouts 504; invalid target/options 400; input limits and short/unsupported target passages 422. Local mode keeps its original Host/Origin restrictions. Render mode uses exact configured public origins and password authentication; see DEPLOY_RENDER.md. It provides one shared account and one active rewrite, not multi-user account management.

## Check your own passage

```sh
node --test
node scripts/doctor.js
node scripts/check-detector.js passage.txt
node scripts/evaluate-target.js passage.txt 20
```

`check-detector.js` prints a real local detector report without rewriting. `evaluate-target.js` runs real local generation, review and scoring, and writes `target-evaluation-results.json` including text and unfilled human-review fields. The older `scripts/evaluate.js` still evaluates five normal-mode editing examples.

You can also scan both passages in your Veritas Scanner, export its JSON reports, and import them in **Compare actual Veritas Scanner results**. Imports must match the exact passages, complete coverage, model and revision. **Download comparison JSON** includes all candidates and local target measurements alongside any imported Scanner summaries. Its search result records the best candidate; the currently selected alternative also has its own `ai` field.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Detector setup needed | Run `SETUP_TARGET_WINDOWS.bat`; restart and check the connection. |
| Model offline/missing | Open Ollama or run `SETUP_WINDOWS.bat`. |
| Draft has fewer than 100 scanner words | Turn target mode off; do not pad just to get a score. |
| Target not reached | Inspect the best measured candidate, try your own voice sample or another installed local model, and review its meaning. A stricter goal may be unattainable. |
| Original retained | Every measured rewrite was worse/tied, or candidates failed quality/eligibility checks. The table records what happened. |
| Detector load/runtime failure | Rerun detector setup. There is no heuristic success fallback. |
| Long CPU run | Wait for bounded passes or Cancel. Deep target mode can take several minutes. |
| Generation timeout | Close memory-heavy apps or increase `timeoutSeconds` (up to 600). Detector checks have a separate 180-second timeout. |
| Port busy | Stop the old Rewrite process or change its port. |
| Scanner score differs | Check exact text, model/revision, full-model versus fallback, and runtime. |

## Source map and references

`src/rewrite.js` owns generation and review; `src/target-rewrite.js` owns the target search; `src/detector-core.js` owns the copied scoring contract; `src/detector.js` and `src/detector-process.js` manage local inference. `public/` contains the interface and shared text/target presentation helpers. `scripts/` contains setup and evaluations; `tests/` contains deterministic regressions.

- [Transformers.js local files and cache controls](https://huggingface.co/docs/transformers.js/v3.8.1/api/env)
- [Pinned classifier files](https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/tree/b9aa251e5bcda7e429fcc936767d921435945b60/onnx)
- [Ollama local-only FAQ](https://docs.ollama.com/faq)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Llama 3.2](https://ollama.com/library/llama3.2) and [Qwen2.5 7B](https://ollama.com/library/qwen2.5:7b)

Project code is MIT-licensed. Downloaded runtime packages and models retain their own licenses. See `TEST_REPORT.md` for validation scope and remaining limitations.
