"""Remove the original factory NPC's white matte without redrawing the subject.

Run: uv run --with pillow --with numpy --with scipy python scripts/extractFactoryTrainer.py
"""
from pathlib import Path
import hashlib
import json

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets/trainers/factory-clown.png"
TARGET = ROOT / "public/assets/trainers/factory-clown-cutout.png"

rgb = np.asarray(Image.open(SOURCE).convert("RGB"), dtype=np.float32)
# Only near-white pixels connected to the outside are background. This keeps
# enclosed white costume highlights, stockings, hat bobbles and the red ball.
candidate = np.min(rgb, axis=2) >= 246
border = np.zeros(candidate.shape, dtype=bool)
border[[0, -1], :] = True
border[:, [0, -1]] = True
background = ndimage.binary_propagation(border & candidate, mask=candidate)
foreground = ~background
# Compression around the white matte leaves tiny detached specks. The body and
# juggling ball are the only substantial components; keep both and clean narrow
# single-pixel protrusions without changing the full-size interior.
labels, _ = ndimage.label(foreground)
sizes = np.bincount(labels.ravel())
foreground &= sizes[labels] >= 100
foreground = ndimage.binary_opening(foreground, border_value=0)
background = ~foreground
distance = ndimage.distance_transform_edt(foreground)
core = distance > 4
_, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
reference = rgb[tuple(nearest)]
alpha = foreground.astype(np.float32)
# Estimate the original white-matte mixture in the four-pixel silhouette band.
# Interior pixels are left byte-for-byte unchanged; no resampling is applied.
edge = foreground & ~core
contrast = 255 - rgb
reference_contrast = 255 - reference
denominator = np.sum(reference_contrast ** 2, axis=2)
coverage = np.sum(contrast * reference_contrast, axis=2) / np.maximum(denominator, 1)
alpha[edge] = np.clip(coverage[edge], 0, 1)
clean = rgb.copy()
clean[edge] = np.clip((rgb[edge] - 255 * (1 - alpha[edge, None])) / np.maximum(alpha[edge, None], 0.001), 0, 255)
clean[background] = 0
rgba = np.dstack((np.rint(clean).astype(np.uint8), np.rint(alpha * 255).astype(np.uint8)))
Image.fromarray(rgba).save(TARGET, optimize=True)
report = {
    "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
    "output": str(TARGET.relative_to(ROOT)).replace("\\", "/"),
    "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "outputSha256": hashlib.sha256(TARGET.read_bytes()).hexdigest(),
    "size": [rgba.shape[1], rgba.shape[0]],
    "mode": "RGBA",
    "transparentPixels": int(np.sum(rgba[:, :, 3] == 0)),
    "opaquePixels": int(np.sum(rgba[:, :, 3] == 255)),
    "partialAlphaPixels": int(np.sum((rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 255))),
    "interiorRgbUnchanged": bool(np.array_equal(rgba[core, :3], rgb[core].astype(np.uint8))),
    "method": "Edge-connected near-white matte extraction, four-pixel edge decontamination; original RGB interior, pose, composition and resolution preserved.",
}
TARGET.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
