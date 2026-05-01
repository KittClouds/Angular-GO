import torch
from gliner import GLiNER

model_id = "knowledgator/gliner-bi-small-v2.0"
model = GLiNER.from_pretrained(model_id)

labels = ["Person", "Organization"]

# Inspect how labels are processed
# In gliner v0.2.8, labels are processed in model.preprocess_labels
print("Processing labels...")
label_set = model.preprocess_labels(labels)

# The label_set contains 'input_ids' and 'attention_mask'
print("Labels Input IDs (first label):", label_set['input_ids'][0].tolist())
print("Labels Decoded (first label):", model.labels_tokenizer.decode(label_set['input_ids'][0]))
