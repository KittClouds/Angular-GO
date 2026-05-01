from __future__ import annotations

import json
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

try:
    from onnxruntime.quantization import QuantType, quantize_dynamic
except Exception:  # pragma: no cover - optional local tool dependency
    QuantType = None
    quantize_dynamic = None

from gliner.model import BiEncoderSpanGLiNER


MODEL_DIR = Path("gliner-bi-small-onnx")
ONNX_NAME = "model_label_embeds.onnx"
QUANTIZED_NAME = "model_label_embeds_quantized.onnx"
EMBEDDINGS_NAME = "labels_embeddings.json"


COMMON_LABELS = [
    "Ability",
    "Algorithm",
    "Alliance",
    "Artifact",
    "Attribute",
    "Benchmark",
    "Character",
    "Claim",
    "Concept",
    "Court",
    "Creature",
    "Dataset",
    "Department",
    "Emotion",
    "Enemy",
    "Error",
    "Event",
    "Executive",
    "Faction",
    "Function",
    "Goal",
    "Institution",
    "Initiative",
    "Item",
    "Jurisdiction",
    "Landmark",
    "Library",
    "Location",
    "Member",
    "Method",
    "Metric",
    "Module",
    "NPC",
    "Object",
    "Organization",
    "Other",
    "Paper",
    "Party",
    "Person",
    "Product",
    "Rank",
    "Region",
    "Relationship",
    "Researcher",
    "Risk",
    "Role",
    "Ruling",
    "Spell",
    "State",
    "Statute",
    "Theory",
    "Weapon",
]


class LabelEmbedsWrapper(nn.Module):
    def __init__(self, core: nn.Module):
        super().__init__()
        self.core = core

    def forward(
        self,
        input_ids,
        attention_mask,
        words_mask,
        text_lengths,
        span_idx,
        span_mask,
        labels_embeds,
    ):
        out = self.core(
            input_ids=input_ids,
            attention_mask=attention_mask,
            words_mask=words_mask,
            text_lengths=text_lengths,
            span_idx=span_idx,
            span_mask=span_mask,
            labels_embeds=labels_embeds,
        )
        return out.logits


def build_dummy_batch(model: BiEncoderSpanGLiNER) -> dict[str, torch.Tensor]:
    tokens, _, _ = model.prepare_inputs(["ONNX export dummy input for GLiNER bi-encoder."])
    input_x = model.prepare_base_input(tokens)
    collator = model.data_collator_class(
        model.config,
        data_processor=model.data_processor,
        return_tokens=False,
        return_entities=False,
        return_id_to_classes=False,
        prepare_labels=False,
    )

    def collate_fn(batch):
        return collator(batch, entity_types=COMMON_LABELS)

    loader = DataLoader(input_x, batch_size=1, shuffle=False, collate_fn=collate_fn)
    batch = next(iter(loader))
    return {key: value.to("cpu") if isinstance(value, torch.Tensor) else value for key, value in batch.items()}


def write_embeddings(model: BiEncoderSpanGLiNER, labels: list[str]) -> torch.Tensor:
    labels_embeds = model.encode_labels(labels).detach().to("cpu").float().contiguous()
    rows = [
        {
            "label": label,
            "embedding": labels_embeds[index].tolist(),
        }
        for index, label in enumerate(labels)
    ]
    payload = {
        "input_name": "labels_embeds",
        "hidden_size": labels_embeds.shape[1],
        "labels": rows,
    }
    (MODEL_DIR / EMBEDDINGS_NAME).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return labels_embeds


def main() -> None:
    model = BiEncoderSpanGLiNER.from_pretrained(str(MODEL_DIR), load_tokenizer=True)
    model.eval()
    core = model.model.to("cpu").eval()

    batch = build_dummy_batch(model)
    labels_embeds = write_embeddings(model, COMMON_LABELS)

    input_names = [
        "input_ids",
        "attention_mask",
        "words_mask",
        "text_lengths",
        "span_idx",
        "span_mask",
        "labels_embeds",
    ]
    output_names = ["logits"]
    inputs = tuple(labels_embeds if name == "labels_embeds" else batch[name] for name in input_names)
    dynamic_axes = {
        "input_ids": {0: "batch_size", 1: "sequence_length"},
        "attention_mask": {0: "batch_size", 1: "sequence_length"},
        "words_mask": {0: "batch_size", 1: "sequence_length"},
        "text_lengths": {0: "batch_size", 1: "value"},
        "span_idx": {0: "batch_size", 1: "num_spans", 2: "idx"},
        "span_mask": {0: "batch_size", 1: "num_spans"},
        "labels_embeds": {0: "num_labels", 1: "hidden_size"},
        "logits": {0: "batch_size", 1: "num_words", 2: "max_width", 3: "num_labels"},
    }

    onnx_path = MODEL_DIR / ONNX_NAME
    torch.onnx.export(
        LabelEmbedsWrapper(core),
        inputs,
        f=str(onnx_path),
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        opset_version=18,
        dynamo=False,
    )

    if quantize_dynamic is not None:
        quantize_dynamic(
            model_input=str(onnx_path),
            model_output=str(MODEL_DIR / QUANTIZED_NAME),
            weight_type=QuantType.QUInt8,
        )

    print(f"wrote {onnx_path}")
    print(f"wrote {MODEL_DIR / EMBEDDINGS_NAME}")


if __name__ == "__main__":
    main()
