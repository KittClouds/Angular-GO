import { env, pipeline } from '@huggingface/transformers';
console.log('Testing dtypes...');

async function test(dtype) {
  try {
    let tokenizer = await pipeline('text-generation', 'onnx-community/LFM2.5-350M-ONNX', { dtype });
    console.log(`Success with ${dtype}`);
  } catch (err) {
    console.log(`Failed with ${dtype}: ${err.message || err}`);
  }
}

await test('q8');
await test('fp16');
await test('fp32');
