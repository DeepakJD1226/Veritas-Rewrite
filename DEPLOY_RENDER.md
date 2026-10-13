# Deploy Veritas Rewrite 3.1 on Render

This package runs the web interface, Node.js backend, Ollama writing model and pinned Veritas detector in one Docker web service. Your laptop can be switched off after deployment. Drafts travel over HTTPS to your Render server; generation and detection run inside that server. There is no external writing API or API key.

**This setup needs a paid service plus a persistent disk.** Start with an **8 GB RAM** instance for the default `llama3.2:latest` model and monitor memory. This is a starting estimate, not a measured capacity guarantee. Render lists 2 CPU / 8 GB and 4 CPU / 8 GB options; more CPU can help inference speed, but latency has not been benchmarked. Review the actual monthly estimate in Render before creating the service: https://render.com/pricing. The Free instance cannot attach the disk this configuration relies on.

## 1. Extract this version

Extract the complete ZIP into a normal folder. Confirm it contains `Dockerfile`, `package.json`, `package-lock.json`, `server.js`, `src/`, `public/`, and `scripts/`. Use the files from version 3.1; the original Windows-only package binds to localhost and does not start hosted models.

## 2. Upload the source to GitHub

1. Sign in at https://github.com and create a repository named `veritas-rewrite`. A private repository is suitable.
2. Use **Add file → Upload files** (or the upload link in a new empty repository).
3. Upload the **contents** of the extracted `Veritas-Rewrite` folder, including its subfolders. `Dockerfile` and `package.json` should appear directly at the repository root.
4. Commit the upload to `main`.

Upload source files, not the ZIP. Keep installed `node_modules`, downloaded model caches, your local `settings.json`, `.env` files and passwords out of GitHub. These are already excluded from the supplied ZIP and ignore files cover local installations.

## 3. Create a Render web service

Open https://dashboard.render.com, choose **New → Web Service → Git Provider**, connect GitHub, and select your repository.

| Setting | Value |
| --- | --- |
| Name | `veritas-rewrite`, or another available name |
| Region | A nearby region, such as Singapore for users in India |
| Branch | `main`, or the branch you uploaded |
| Root directory | Leave blank when the project files are at the repository root |
| Language / runtime | **Docker** |
| Dockerfile path | `./Dockerfile` |
| Docker build context | Repository root / `.` |
| Docker Command | Leave blank; the Dockerfile supplies startup |
| Instance | Paid instance with 8 GB RAM as an initial estimate |

The Dockerfile installs dependencies. Do not replace its startup with `npm start`, because the Render launcher also starts and checks both models. If you see ordinary Node Build/Start Command fields, check that the runtime is Docker.

If you uploaded the containing folder instead, either move its contents to the repository root or set Root Directory to `Veritas-Rewrite`. Keep the Dockerfile and build context within that selected project directory.

## 4. Add environment variables

Use Render's Environment section. Values are plain values, without surrounding quotes.

| Key | Value |
| --- | --- |
| `VERITAS_DEPLOYMENT` | `render` |
| `VERITAS_ACCESS_USER` | `admin` |
| `VERITAS_ACCESS_PASSWORD` | Your own unique password, 16–256 characters; generate one in a password manager |
| `VERITAS_MODEL` | `llama3.2:latest` |
| `VERITAS_TIMEOUT` | `300` |

The timeout is **per model call**, in seconds, not for the entire multi-pass job. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; leave those alone. The Dockerfile sets model storage to `/var/data/ollama`, the detector cache to `/var/data/detector`, and keeps Ollama on the container's private loopback address. No Ollama port should be exposed as a separate public service.

## 5. Attach persistent storage

Under **Advanced → Add Disk** (or the service's Disk page):

- Mount path: `/var/data`
- Size: **10 GB** as a starting allocation for the default model and detector

Attach it before the first startup to avoid downloading into temporary storage. Only files beneath this mount survive restarts. Model downloads happen at runtime, because Render disks are not available during the Docker build. Changing to a larger model can require more disk and RAM.

## 6. Set the health check and deploy

Set **Health Check Path** to `/healthz`. Review the instance and disk charges, then click **Create Web Service**.

Open the service's logs. Docker first builds the image; this includes a large Ollama image and the detector runtime. The startup sequence then:

1. Opens the web server on `0.0.0.0:$PORT`.
2. Starts Ollama privately inside the container.
3. Downloads the writing model if it is missing.
4. Downloads and verifies the pinned detector if it is missing.
5. Checks the saved detector with downloads disabled.
6. Logs **`[startup] Models ready. You can now rewrite up to 300 words.`**

First startup can take several minutes or longer depending on build/download speed. Model downloads are reused on later restarts. The app can open while initialization is happening; its status updates automatically. Render showing **Live**, or `/healthz` returning `ok`, means the web process is running. Wait for **Server models ready** before attempting a rewrite.

## 7. Open and test

1. Open the HTTPS `onrender.com` address shown on the Render dashboard.
2. The browser asks for a username and password: enter `admin` and the password you set in Render.
3. Wait for **Server models ready**. Check the footer says **v3.1 · SERVER**.
4. For a quick first generation check, switch target mode off, select Quick edit, and submit a short paragraph. Confirm you receive a rewrite or a specific validation error rather than a missing-model error.
5. To check target mode, use an English draft of **100–300 words** and enable the target. Normal mode accepts **1–300 words**. Backend validation also rejects input above 300 words.
6. Check the actual score, wording and meaning. A requested score below 20% is a goal; deployment does not guarantee it.

Deep target runs use several generation, review and classifier passes. CPU generation may take minutes. This service allows one rewrite at a time; it is intended for a small private deployment, not a multi-tenant public product. Browser Basic authentication uses one shared account, not individual user accounts.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Dockerfile cannot be found | Repository folder layout, Root Directory and Dockerfile path |
| Ordinary Node build/start fields | Select Docker as the runtime |
| Password configuration error | Set a unique password of at least 16 characters in Render Environment |
| Browser keeps asking for credentials | Use the exact configured username and password; check for pasted spaces |
| Port scan finds no open port | Leave Docker Command blank; use the supplied Dockerfile and launcher |
| Rewrite button stays disabled | Wait for model readiness; add valid text; target mode needs 100–300 words |
| Setup or model download failed | Read startup logs; confirm disk mount `/var/data`, free disk space and outbound model downloads; redeploy after fixing |
| Out-of-memory / exit 137 | Inspect Render memory metrics and move to more RAM; avoid selecting the optional larger model on the initial instance |
| Model call timeout | Test Quick edit first and inspect CPU/memory; a faster compute plan may be needed |
| Model downloads repeat after restart | Verify a persistent disk is attached at exactly `/var/data` |
| Public URL is blocked | Use the service's exact HTTPS address. For a custom domain, set `VERITAS_PUBLIC_URL=https://your-domain.example` with no path, after configuring the domain in Render |

To update later, commit the replacement source to the connected branch and let Render redeploy (or choose a manual deploy). The disk preserves the models. Disk-backed services can have downtime while restarting; avoid deploying during an active rewrite. Export any output you want to keep; the app stores no draft history.

## Validation status

The application and hosted HTTP controls passed 87 automated tests in the development environment. Docker is unavailable in that environment: this Docker image has **not** been built there, and no live Render deployment or real Ollama generation has been benchmarked. See `TEST_REPORT.md` for the exact checks and limitations. Keep the first deployment private while performing step 7.

Official references checked 13 October 2026:

- Render web services: https://render.com/docs/web-services
- Docker deployment: https://render.com/docs/docker
- Persistent disks: https://render.com/docs/disks
- Default environment variables: https://render.com/docs/environment-variables
- Compute sizes: https://render.com/docs/blueprint-spec
- Ollama Docker: https://docs.ollama.com/docker
