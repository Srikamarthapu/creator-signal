export function evaluationMakesUnsupportedInference(evaluation) {
  const text = [
    evaluation?.summary,
    ...(Array.isArray(evaluation?.strengths) ? evaluation.strengths : []),
    ...(Array.isArray(evaluation?.risks) ? evaluation.risks : []),
    evaluation?.recommendedUse
  ].filter(Boolean).join(" ");
  return [
    /\b(?:views?|view count)\b.{0,90}\b(?:engagement|reach|conversions?|sales|revenue|performance|impact|roi)\b/i,
    /\b(?:engagement|reach|conversions?|sales|revenue|performance|impact|roi)\b.{0,90}\b(?:views?|view count)\b/i,
    /\b(?:suggests?|indicates?|means?|shows?|proves?)\b.{0,70}\b(?:engagement|reach|conversions?|sales|revenue|roi)\b/i,
    /\b(?:guarantee(?:s|d)?|likely|unlikely)\b.{0,70}\b(?:conversions?|sales|revenue|roi)\b/i
  ].some((pattern) => pattern.test(text));
}

export function sourceEvaluationCeiling(influencer) {
  const confidence = String(influencer?.confidence || "Low");
  const sourceType = String(influencer?.sourceType || "searchResult");
  if (confidence === "Low" && sourceType === "searchResult") return 68;
  if (confidence === "Low" || sourceType === "article") return 72;
  if (sourceType === "searchResult") return 78;
  if (confidence === "Medium") return 86;
  return 94;
}
