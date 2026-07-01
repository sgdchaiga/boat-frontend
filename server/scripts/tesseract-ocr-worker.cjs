const { createWorker } = require("tesseract.js");
const path = require("node:path");
const sharp = require("sharp");

async function buildVariants(imagePath) {
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath));
  const metadata = await sharp(imagePath).metadata();
  const scale = metadata.width && metadata.width < 1800 ? Math.min(3, Math.ceil(1800 / metadata.width)) : 1;
  const resize = scale > 1 ? { width: Math.round((metadata.width || 1000) * scale) } : {};
  const variants = [{ label: "original", path: imagePath }];

  const normalizedPath = path.join(dir, `${base}-normalized.png`);
  await sharp(imagePath)
    .rotate()
    .resize(resize)
    .grayscale()
    .normalize()
    .median(1)
    .sharpen()
    .png()
    .toFile(normalizedPath);
  variants.push({ label: "normalized", path: normalizedPath });

  const contrastPath = path.join(dir, `${base}-contrast.png`);
  await sharp(imagePath)
    .rotate()
    .resize(resize)
    .grayscale()
    .linear(1.35, -18)
    .sharpen({ sigma: 1.1 })
    .png()
    .toFile(contrastPath);
  variants.push({ label: "contrast", path: contrastPath });

  const thresholdPath = path.join(dir, `${base}-threshold.png`);
  await sharp(imagePath)
    .rotate()
    .resize(resize)
    .grayscale()
    .normalize()
    .threshold(165)
    .png()
    .toFile(thresholdPath);
  variants.push({ label: "threshold", path: thresholdPath });

  return variants;
}

function scoreText(text, confidence) {
  const trimmed = (text || "").trim();
  const letters = (trimmed.match(/[A-Za-z0-9]/g) || []).length;
  const noise = (trimmed.match(/[^\sA-Za-z0-9.,:;/'"()#%&@+\-=]/g) || []).length;
  return (Number(confidence) || 0) + letters * 0.35 - noise * 1.5;
}

async function main() {
  const imagePath = process.argv[2];
  const language = process.argv[3] || "eng";
  if (!imagePath) {
    throw new Error("Missing image path.");
  }

  const worker = await createWorker(language);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;/'\"()#%&@+-= \n\t",
    });

    const variants = await buildVariants(imagePath);
    let best = { text: "", confidence: 0, label: "original", score: Number.NEGATIVE_INFINITY };
    for (const variant of variants) {
      const result = await worker.recognize(variant.path);
      const text = (result.data.text || "").trim();
      const confidence = Number(result.data.confidence) || 0;
      const score = scoreText(text, confidence);
      if (score > best.score) {
        best = { text, confidence, label: variant.label, score };
      }
    }
    process.stdout.write(
      JSON.stringify({
        ok: true,
        text: best.text,
        confidence: best.confidence,
        preprocessing: best.label,
      })
    );
  } finally {
    await worker.terminate();
  }
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      message: error instanceof Error ? error.message : "Tesseract OCR failed.",
    })
  );
  process.exit(1);
});
