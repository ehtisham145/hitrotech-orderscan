// Browser-side file expansion: HEIC → JPG, ZIP → images, PDF → per-page PNGs.
// Runs entirely on the client so the server only ever receives standard images.
// Includes browser-side optimization (resize/compress) to minimize upload bandwidth.

import { toast } from "sonner";

export type ProcessProgress = (msg: string) => void;

const IMAGE_EXTS = /\.(png|jpe?g|webp|gif|bmp)$/i;
const HEIC_EXTS = /\.(heic|heif)$/i;
const ZIP_EXTS = /\.zip$/i;
const PDF_EXTS = /\.pdf$/i;

// Target dimensions for OCR stability while minimizing size.
const TARGET_MAX_WIDTH = 1200;
const TARGET_MAX_HEIGHT = 1600;
const TARGET_QUALITY = 0.8;

function isImageLike(f: File) {
  return f.type.startsWith("image/") || IMAGE_EXTS.test(f.name);
}
function isHeic(f: File) {
  return HEIC_EXTS.test(f.name) || f.type === "image/heic" || f.type === "image/heif";
}
function isZip(f: File) {
  return ZIP_EXTS.test(f.name) || f.type === "application/zip";
}
function isPdf(f: File) {
  return PDF_EXTS.test(f.name) || f.type === "application/pdf";
}

async function optimizeImage(f: File): Promise<File> {
  // We use the browser's Canvas API to resize and re-encode to JPEG.
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    
    // Set a timeout to prevent hanging on corrupted images
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Image processing timed out"));
    }, 15000);

    img.onload = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      let { width, height } = img;
      
      // Calculate new dimensions keeping aspect ratio
      if (width > TARGET_MAX_WIDTH || height > TARGET_MAX_HEIGHT) {
        const ratio = Math.min(TARGET_MAX_WIDTH / width, TARGET_MAX_HEIGHT / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
      } else if (f.size < 200 * 1024 && (f.type === "image/jpeg" || f.type === "image/jpg")) {
        // If already small enough and JPEG, skip re-processing.
        return resolve(f);
      }

      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("Could not get canvas context");
        
        ctx.fillStyle = "white"; // Handle transparency for non-JPEGs
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Canvas blob generation failed"));
            const base = f.name.split(".").slice(0, -1).join(".") || "image";
            resolve(new File([blob], `${base}.jpg`, { type: "image/jpeg" }));
          },
          "image/jpeg",
          TARGET_QUALITY
        );
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${f.name}`));
    };
    img.src = url;
  });
}

async function convertHeic(f: File): Promise<File> {
  const { heicTo } = await import("heic-to");
  const blob = await heicTo({ blob: f, type: "image/jpeg", quality: 0.9 });
  const outBlob = Array.isArray(blob) ? blob[0] : blob;
  const base = f.name.replace(HEIC_EXTS, "");
  return new File([outBlob], `${base}.jpg`, { type: "image/jpeg" });
}

async function expandZip(f: File, onProgress?: ProcessProgress): Promise<File[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(f);
  const out: File[] = [];
  const entries: Array<{ name: string; entry: import("jszip").JSZipObject }> = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (path.startsWith("__MACOSX/")) return;
    entries.push({ name: path, entry });
  });
  for (let i = 0; i < entries.length; i++) {
    const { name, entry } = entries[i];
    const nested = new File([await entry.async("blob")], name.split("/").pop() ?? name);
    onProgress?.(`Unzipping ${i + 1}/${entries.length}`);
    const expanded = await expandOne(nested, onProgress);
    out.push(...expanded);
  }
  return out;
}

async function expandPdf(f: File, onProgress?: ProcessProgress): Promise<File[]> {
  // pdfjs-dist is heavy; import lazily.
  const pdfjs = await import("pdfjs-dist");
  // Use the bundled worker via URL — Vite/Bun resolves this at build time.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await f.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: File[] = [];
  const base = f.name.replace(PDF_EXTS, "");
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(`Rendering PDF page ${p}/${doc.numPages}`);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx as any, viewport, canvas } as any).promise;
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png", 0.92));
    out.push(new File([blob], `${base}-p${p}.png`, { type: "image/png" }));
    canvas.width = 0;
    canvas.height = 0;
  }
  return out;
}

async function expandOne(f: File, onProgress?: ProcessProgress): Promise<File[]> {
  try {
    if (isZip(f)) return await expandZip(f, onProgress);
    if (isPdf(f)) return await expandPdf(f, onProgress);
    if (isHeic(f)) return [await optimizeImage(await convertHeic(f))];
    if (isImageLike(f)) return [await optimizeImage(f)];
  } catch (err) {
    console.error(`expandOne failed for ${f.name}:`, err);
    throw err;
  }
  // Unknown file — silently skip.
  return [];
}

export async function processInputFiles(files: File[], onProgress?: ProcessProgress): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(`Preparing ${i + 1}/${files.length}: ${files[i].name}`);
    try {
      const expanded = await expandOne(files[i], onProgress);
      if (expanded.length === 0) {
        console.warn(`No valid images found in: ${files[i].name}`);
      }
      out.push(...expanded);
    } catch (err) {
      console.error("processInputFiles error", files[i].name, err);
      // Don't throw here, just skip the bad file and continue
      toast.error(`Failed to process ${files[i].name}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }
  return out;
}
