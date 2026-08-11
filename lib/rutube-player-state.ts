export type RutubePlayerStatus = "loading" | "ready" | "embed-restricted" | "unavailable" | "player-error";

const EMBED_RESTRICTION_PATTERNS = [
  /только\s+(?:на|в)\s+(?:сайте\s+)?rutube/u,
  /(?:сторонн[а-я]*\s+сайт[а-я]*|встраиван|эмбед)[^\n]{0,100}(?:не\s+разреш|запрещ|огранич|недоступ)/u,
  /(?:не\s+разреш|запрещ|огранич|недоступ)[^\n]{0,100}(?:сторонн[а-я]*\s+сайт[а-я]*|встраиван|эмбед)/u,
  /(?:embed|embedding)[^\n]{0,100}(?:denied|forbidden|not\s+allowed|restricted)/u,
];

const UNAVAILABLE_PATTERNS = [
  /не\s+найден/u,
  /недоступ/u,
  /удал[её]н/u,
  /заблокирован/u,
  /not\s+found/u,
  /unavailable/u,
  /deleted/u,
  /removed/u,
  /blocked/u,
];

export function classifyRutubePlayerError(data: Record<string, unknown> | undefined): Exclude<RutubePlayerStatus, "loading" | "ready"> {
  const errorType = typeof data?.type === "string" ? data.type.toLocaleLowerCase("en-US") : "";
  if (errorType === "blocked_by_copyright") return "embed-restricted";
  const text = typeof data?.text === "string" ? data.text : typeof data?.message === "string" ? data.message : "";
  const normalized = text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
  if (EMBED_RESTRICTION_PATTERNS.some((pattern) => pattern.test(normalized))) return "embed-restricted";
  if (UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(normalized))) return "unavailable";
  return "player-error";
}
