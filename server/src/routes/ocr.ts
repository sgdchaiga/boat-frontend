import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";

type ImageOcrBody = {
  data_url?: string;
  file_name?: string;
};

type ParsedImageDataUrl = {
  mime: string;
  base64: string;
};

type TesseractWorkerResponse = {
  ok?: boolean;
  text?: string;
  confidence?: number;
  preprocessing?: string;
  message?: string;
};

function parseImageDataUrl(dataUrl: string): { ok: true; image: ParsedImageDataUrl } | { ok: false; message: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return { ok: false, message: "OCR expects an image data URL." };
  const mime = match[1].toLowerCase();
  const allowed = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp", "image/tiff"]);
  if (!allowed.has(mime)) return { ok: false, message: "Unsupported image type for OCR." };
  const base64 = match[2].replace(/\s/g, "");
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes <= 0) return { ok: false, message: "OCR image is empty." };
  if (approxBytes > 15 * 1024 * 1024) return { ok: false, message: "OCR image is too large. Use an image under 15 MB." };
  return { ok: true, image: { mime, base64 } };
}

async function runOpenAiOcr(dataUrl: string): Promise<{ text: string; model: string }> {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_OCR_MODEL?.trim() || "gpt-4o-mini";
  if (!openAiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const prompt = [
    "Extract all readable text from this business document image.",
    "Preserve line breaks and columns as much as possible.",
    "If the image contains a table, output each table row on a new line and separate columns with tabs.",
    "Return only the extracted text. Do not add commentary.",
  ].join(" ");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });

  const raw = await res.text();
  let parsed: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    throw new Error(parsed.error?.message || raw.slice(0, 500) || res.statusText);
  }

  return { text: parsed.choices?.[0]?.message?.content?.trim() || "", model };
}

async function runTesseractOcr(image: ParsedImageDataUrl): Promise<{ text: string; confidence?: number; preprocessing?: string }> {
  const language = process.env.TESSERACT_OCR_LANGUAGE?.trim() || "eng";
  const extByMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  const tempDir = await mkdtemp(path.join(tmpdir(), "boat-ocr-"));
  const imagePath = path.join(tempDir, `${randomUUID()}.${extByMime[image.mime] || "img"}`);
  try {
    await writeFile(imagePath, Buffer.from(image.base64, "base64"));
    const workerScript = path.resolve(process.cwd(), "scripts", "tesseract-ocr-worker.cjs");
    const result = await new Promise<TesseractWorkerResponse>((resolve, reject) => {
      const child = spawn(process.execPath, [workerScript, imagePath, language], {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Tesseract OCR timed out. Try a clearer or smaller image."));
      }, 60000);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const parsed = stdout ? (JSON.parse(stdout) as TesseractWorkerResponse) : {};
          if (code === 0 && parsed.ok !== false) {
            resolve(parsed);
            return;
          }
          reject(new Error(parsed.message || stderr.trim() || "Tesseract OCR failed."));
        } catch (error) {
          reject(error);
        }
      });
    });
    return { text: (result.text || "").trim(), confidence: result.confidence, preprocessing: result.preprocessing };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export const ocrRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ImageOcrBody }>("/ocr/image-document", async (req, reply) => {
    const dataUrl = typeof req.body?.data_url === "string" ? req.body.data_url.trim() : "";
    const validation = parseImageDataUrl(dataUrl);
    if (!validation.ok) {
      return reply.code(400).send({ ok: false, error: "invalid_image", message: validation.message });
    }

    const preferOpenAi = process.env.OPENAI_API_KEY?.trim() && process.env.OCR_PROVIDER?.trim() !== "tesseract";
    let openAiError = "";

    if (preferOpenAi) {
      try {
        const result = await runOpenAiOcr(dataUrl);
        return reply.send({
          ok: true,
          text: result.text,
          file_name: req.body?.file_name || null,
          provider: "openai",
          model: result.model,
        });
      } catch (error) {
        openAiError = error instanceof Error ? error.message : "OpenAI OCR failed.";
        req.log.warn({ error: openAiError }, "OpenAI OCR failed; falling back to Tesseract.");
      }
    }

    try {
      const result = await runTesseractOcr(validation.image);
      return reply.send({
        ok: true,
        text: result.text,
        file_name: req.body?.file_name || null,
        provider: "tesseract",
        confidence: result.confidence ?? null,
        preprocessing: result.preprocessing ?? null,
        fallback_from: openAiError ? "openai" : null,
        fallback_reason: openAiError || null,
      });
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: "online_ocr_failed",
        message:
          error instanceof Error
            ? error.message
            : "OCR failed. Try a clearer image or enter the text manually.",
        fallback_reason: openAiError || null,
      });
    }
  });
};
