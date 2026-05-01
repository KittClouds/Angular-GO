import onnxruntime as ort
from gliner import GLiNER
from transformers import AutoTokenizer

model_id = "knowledgator/gliner-bi-small-v2.0"
local_dir = "gliner-bi-small-onnx"

print("Loading PyTorch model for tokenizer...")
model = GLiNER.from_pretrained(model_id)

text = "Microsoft was founded by Bill Gates and Paul Allen."
labels = ["Person", "Organization"]

print("Testing ONNX with Python gliner integration...")
onnx_model = GLiNER.from_pretrained(local_dir, load_tokenizer=True)
# Override the internal model with the ONNX session
# Actually, GLiNER library has built-in ONNX support if you pass the directory!
onnx_model.model_path = f"{local_dir}/model.onnx" # force it to use ONNX if not already

try:
    from gliner.inference.onnx_inference import OnnxGLiNER
    ort_model = OnnxGLiNER(f"{local_dir}/model.onnx")
    entities = onnx_model.predict_entities(text, labels)
    print("ONNX Output:", entities)
except Exception as e:
    print("Failed to run natively through GLiNER:", e)
