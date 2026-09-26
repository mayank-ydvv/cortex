import type { NextConfig } from 'next';

const config: NextConfig = {
  // onnxruntime-node ships native .node binaries. Bundling them breaks the
  // build, so the embedding stack stays external and is required at runtime.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'postgres'],
};

export default config;
