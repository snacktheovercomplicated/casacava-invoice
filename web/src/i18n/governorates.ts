/**
 * Egypt's 27 governorates, stored on a customer as a short code.
 *
 * The code is what goes in the database, so the same customer prints
 * "القاهرة" on an Arabic invoice and "Cairo" on an English one without
 * anybody retyping anything.
 */
export interface Governorate {
  code: string;
  ar: string;
  en: string;
}

export const GOVERNORATES: Governorate[] = [
  { code: "CAI", ar: "القاهرة", en: "Cairo" },
  { code: "GIZ", ar: "الجيزة", en: "Giza" },
  { code: "ALX", ar: "الإسكندرية", en: "Alexandria" },
  { code: "KB", ar: "القليوبية", en: "Qalyubia" },
  { code: "SHR", ar: "الشرقية", en: "Sharqia" },
  { code: "DK", ar: "الدقهلية", en: "Dakahlia" },
  { code: "BH", ar: "البحيرة", en: "Beheira" },
  { code: "GH", ar: "الغربية", en: "Gharbia" },
  { code: "MNF", ar: "المنوفية", en: "Monufia" },
  { code: "KFS", ar: "كفر الشيخ", en: "Kafr El Sheikh" },
  { code: "DT", ar: "دمياط", en: "Damietta" },
  { code: "PTS", ar: "بورسعيد", en: "Port Said" },
  { code: "IS", ar: "الإسماعيلية", en: "Ismailia" },
  { code: "SUZ", ar: "السويس", en: "Suez" },
  { code: "SIN", ar: "شمال سيناء", en: "North Sinai" },
  { code: "JS", ar: "جنوب سيناء", en: "South Sinai" },
  { code: "FYM", ar: "الفيوم", en: "Fayoum" },
  { code: "BNS", ar: "بني سويف", en: "Beni Suef" },
  { code: "MN", ar: "المنيا", en: "Minya" },
  { code: "AST", ar: "أسيوط", en: "Asyut" },
  { code: "SHG", ar: "سوهاج", en: "Sohag" },
  { code: "KN", ar: "قنا", en: "Qena" },
  { code: "LX", ar: "الأقصر", en: "Luxor" },
  { code: "ASN", ar: "أسوان", en: "Aswan" },
  { code: "RS", ar: "البحر الأحمر", en: "Red Sea" },
  { code: "WAD", ar: "الوادي الجديد", en: "New Valley" },
  { code: "MT", ar: "مطروح", en: "Matrouh" },
];

const BY_CODE = new Map(GOVERNORATES.map((g) => [g.code, g]));

export function governorateName(code: string | null, lang: "ar" | "en"): string {
  if (!code) return "";
  const found = BY_CODE.get(code);
  return found ? found[lang] : code;
}
