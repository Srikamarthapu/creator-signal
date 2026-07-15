import assert from "node:assert/strict";
import test from "node:test";
import { evaluationMakesUnsupportedInference, sourceEvaluationCeiling } from "./evaluation-guard.mjs";

test("rejects engagement and outcome inferences made from view counts", () => {
  assert.equal(evaluationMakesUnsupportedInference({
    summary: "A desk setup result has 398.8K views.",
    strengths: ["398.8K views suggests strong engagement"],
    risks: [],
    recommendedUse: "Use for a sales campaign."
  }), true);
  assert.equal(evaluationMakesUnsupportedInference({
    summary: "A tutorial has low views.",
    strengths: [],
    risks: ["Low views make meaningful conversions unlikely"],
    recommendedUse: "Do not use."
  }), true);
});

test("allows visible source facts without treating them as private performance evidence", () => {
  assert.equal(evaluationMakesUnsupportedInference({
    summary: "The public result visibly shows a desk setup video.",
    strengths: ["The source title directly matches desk accessories."],
    risks: ["Audience, engagement, rates, and conversions remain unverified."],
    recommendedUse: "Verify the creator profile before outreach."
  }), false);
});

test("caps source-only scores by evidence strength", () => {
  assert.equal(sourceEvaluationCeiling({ confidence: "Low", sourceType: "searchResult" }), 68);
  assert.equal(sourceEvaluationCeiling({ confidence: "Medium", sourceType: "searchResult" }), 78);
  assert.equal(sourceEvaluationCeiling({ confidence: "High", sourceType: "post" }), 94);
});
