import { env, pipeline } from '@huggingface/transformers';
console.log('Testing...');
try {
  let tokenizer = await pipeline('text-generation', 'onnx-community/LFM2.5-350M-ONNX', {
    dtype: 'q4',
  });
  console.log('Success');
} catch (err) {
  console.error(err);
}
