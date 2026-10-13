import { AI_MODEL, AI_REVISION, TRANSFORMERS_VERSION, scoreWithClassifier } from './detector-core.js';

let classifier;
// Separate process: ONNX's native binding cannot safely reload across terminated workers.
process.on('disconnect', () => process.exit(0));
process.on('message', async ({ id, text, config }) => {
  try {
    if (!classifier) {
      const { pipeline, env } = await import('@huggingface/transformers');
      if (env.version !== TRANSFORMERS_VERSION) throw new Error('Detector runtime version does not match the scanner.');
      env.allowLocalModels = true;
      env.localModelPath = config.localModelPath;
      env.allowRemoteModels = config.allowDownload === true;
      env.cacheDir = config.cacheDir;
      env.useFSCache = true;
      env.useBrowserCache = false;
      classifier = await pipeline('text-classification', AI_MODEL, {
        dtype: 'q8', device: 'cpu', revision: AI_REVISION,
        local_files_only: !config.allowDownload,
        progress_callback: data => process.send({ id, type: 'progress', message: data.status === 'progress' ? `Preparing detector: ${Math.round(data.progress || 0)}% (${data.file || 'model'})` : 'Loading the local detector…' })
      });
    }
    const result = await scoreWithClassifier(text, classifier, coverage => process.send({ id, type: 'progress', message: `Checking ${coverage.checkedTokens} / ${coverage.totalTokens} detector tokens` }));
    process.send({ id, type: 'result', result });
  } catch (error) {
    classifier = null;
    // Do not return input, filesystem paths, or arbitrary native error payloads.
    process.send({ id, type: 'error', code: error.code || 'DETECTOR_UNAVAILABLE', message: error.code?.startsWith('DETECTOR_') ? error.message : 'The local detector could not load or run. Run SETUP_TARGET_WINDOWS.bat, then restart the app. Normal rewriting is available with target mode off.' });
  }
});
