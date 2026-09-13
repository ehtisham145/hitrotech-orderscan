// The AI extraction contract: what to extract, how to read ambiguous
// characters, and the exact JSON shape the model must return. Split out of
// extract-core.server.ts so the prompt/schema can be read and tuned on its
// own, without scrolling past the orchestration logic that uses it.
import { z } from "zod";

export const SYSTEM_PROMPT = `You are an expert at extracting structured data from telecom order screenshots (WhatsApp, POS, CRM). Extract every field you can find. If a field is missing, use null. Look carefully — labels may vary (e.g. "MSISDN"/"Mobile"/"Onic Number" all mean phone_number). Return ONLY valid JSON matching this exact schema:

{
  "data": {
    "customer_name": string|null,
    "phone_number": string|null,
    "alternative_contact": string|null,
    "current_network": string|null,
    "sim_type": string|null,
    "number_type": string|null,
    "package_name": string|null,
    "number_charges": string|null,
    "paid_via": string|null,
    "discount": string|null,
    "email": string|null,
    "store_id": string|null,
    "reference": string|null,
    "deposit": string|null,
    "remaining_deposit": string|null,
    "order_number": string|null,
    "cnic": string|null,
    "plan_price": string|null,
    "activation_date": string|null,
    "activation_time": string|null,
    "employee_name": string|null,
    "branch_name": string|null,
    "order_status": string|null,
    "remarks": string|null
  },
  "confidence": {
    "<field_name>": number (0-100)
  }
}

Field hints:
- sim_type: physical SIM type (e.g. "eSIM", "Physical", "Regular")
- number_type: category of the number (e.g. "Golden", "Silver", "Normal", "VIP", "Premium")
- package_name: the plan/package name (e.g. "Onic Ultra 1500", "Postpaid 2000") — NOT the price
- plan_price: the price/tariff amount only

CRITICAL ACCURACY RULES — read every character twice before committing:
1. Character disambiguation: In alphanumeric codes (order_number, reference, store_id) distinguish carefully:
   - digit 0 (zero, narrower, often has slash/dot) vs letter O (rounder, wider)
   - digit 1 vs letter I vs letter l vs letter |
   - digit 5 vs letter S, digit 8 vs letter B, digit 2 vs letter Z, digit 6 vs letter G
   Match the surrounding pattern: if the code is "CXO-XXXXXXXXXXXXX" and other chars are letters, that middle char is likely a letter too; if it's a run of digits, it's a digit. Never guess — if a single character is ambiguous, set that field's confidence below 85.
2. Numeric fields (phone_number, cnic, plan_price, deposit, charges): every character MUST be a digit 0-9 (plus separators). If you see O/I/l/S/B in these, they are almost certainly 0/1/1/5/8. Convert them.
3. Phone numbers: Pakistan mobile format is 11 digits starting 03XX (e.g. 03001234567). CNIC is 13 digits, often shown as XXXXX-XXXXXXX-X.
4. Confidence scoring — be honest, not optimistic:
   - 95-100: crystal clear, every char unambiguous
   - 85-94: readable but one char slightly ambiguous
   - 70-84: partially blurred / cropped / a couple of ambiguous chars
   - below 70: return null instead — do not guess
5. If the screenshot is blurry, cropped, or you cannot clearly read a field, set it to null. A null is better than a wrong value.

Only include confidence entries for fields you actually extracted (non-null). Do not wrap in markdown code fences.`;

export const ExtractionSchema = z.object({
  data: z.record(z.string().nullable()),
  confidence: z.record(z.number()),
});
