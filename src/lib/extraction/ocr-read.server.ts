// Transcribes a screenshot with the OCR service, or returns null if it cannot.
//
// Every failure here is non-fatal by design: the caller falls back to handing
// the screenshot to the model directly. Losing OCR costs accuracy on the field
// layout, not the extraction itself, so it is never worth failing a row over.
export type OcrReadResult = {
  text: string;
  confidence: number;
  /**
   * Per-line text and score, in reading order — the same lines `text` is
   * joined from. The template parser gates each field on the confidence of
   * the line that field actually came from; without this it can only see the
   * page average, where one blurry line of page chrome (an FAQ heading, a
   * status bar) rejects a page whose real fields were read perfectly.
   */
  lines: Array<{ text: string; confidence: number }>;
};

// Upper bound on the OCR service call. Shorter than the AI budget: OCR is the
// optional half of the read, and time spent waiting on it delays a fallback
// that would have answered already.
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 45_000;

export async function readWithOcr(
  bytes: Buffer,
  mimeType: string,
  fileName: string | null,
): Promise<OcrReadResult | null> {
  const ocrUrl = process.env.OCR_URL;
  const ocrApiKey = process.env.OCR_API_KEY;
  if (!ocrUrl) return null;

  const target = `${ocrUrl.replace(/\/+$/, "")}/ocr/upload`;
  const startedAt = Date.now();

  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      fileName || "image.png",
    );

    const res = await fetch(target, {
      method: "POST",
      headers: ocrApiKey ? { "X-API-Key": ocrApiKey } : {},
      body: formData,
      // Without a deadline a stalled worker holds the row open indefinitely.
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status}: ${body.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const text = (json?.text ?? "").trim();
    if (!text) throw new Error("returned no text");
    // 0-1 scale from the OCR service (average of per-line scores). Used by
    // tryTemplateExtraction as its second trust gate.
    const confidence = typeof json?.confidence === "number" ? json.confidence : 0;
    // The service returns `lines: [{ text, confidence, box }]` already sorted
    // into reading order (see ocr-service/app/main.py). Box coordinates are
    // dropped — nothing downstream uses geometry.
    const lines: Array<{ text: string; confidence: number }> = Array.isArray(json?.lines)
      ? json.lines
          .map((l: any) => ({
            text: String(l?.text ?? "").trim(),
            confidence: typeof l?.confidence === "number" ? l.confidence : 0,
          }))
          .filter((l: { text: string }) => l.text.length > 0)
      : [];

    console.log(
      `[extract-core] OCR read ${text.length} chars / ${lines.length} lines in ${Date.now() - startedAt}ms`,
    );
    return { text, confidence, lines };
  } catch (err: any) {
    console.warn(
      `[extract-core] OCR unavailable after ${Date.now() - startedAt}ms (${err.message}) — sending the screenshot to the model instead`,
    );
    return null;
  }
}
