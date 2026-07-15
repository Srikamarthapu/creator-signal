import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetResearchSessionsForTests,
  draftGroundedCampaignBrief,
  draftGroundedOutreach,
  planCreatorDiscovery,
  runGroundedCampaignAgent,
  upsertResearchSession
} from "./research-agent.mjs";

const input = {
  product: "wireless mouse",
  goal: "Sales",
  platform: "TikTok",
  audience: "Millennial"
};

const influencer = {
  displayName: "Desk Tech",
  handle: "desktech",
  platform: "TikTok",
  sourceUrl: "https://www.tiktok.com/@desktech/video/123",
  sourceTitle: "Quiet wireless mouse desk setup",
  sourceDescription: "A creator demonstrates a quiet wireless mouse in a home office setup.",
  niche: "Desk technology",
  matchReason: "The public post visibly demonstrates the searched product category.",
  evidence: ["wireless mouse", "desk setup", "product demo"],
  confidence: "Medium",
  sourceType: "post",
  matchScore: 88
};

function createSession() {
  return upsertResearchSession({
    id: "3f50dbde-a640-4f24-a748-2f9c7e9e7a11",
    input,
    influencerSources: [{
      title: influencer.sourceTitle,
      source: "tiktok.com",
      description: influencer.sourceDescription,
      link: influencer.sourceUrl,
      rank: 1
    }],
    influencers: [influencer]
  });
}

test.beforeEach(() => __resetResearchSessionsForTests());

test("discovery planner asks for the product when no usable search exists", async () => {
  const result = await planCreatorDiscovery({
    messages: [{ role: "user", content: "Can you help me find the right influencer?" }],
    currentSearch: {},
    nvidia: {}
  });

  assert.equal(result.action, "clarify");
  assert.equal(result.searchPlan, null);
  assert.equal(result.toolsUsed[0].name, "ask_discovery_question");
  assert.match(result.answer, /product|service|category/i);
});

test("GLM discovery uses the bounded find tool and returns only a search plan", async () => {
  let requestBody;
  const result = await planCreatorDiscovery({
    messages: [{ role: "user", content: "Find YouTube reviewers for our ergonomic mouse launch, focused on remote professionals." }],
    currentSearch: {
      product: "",
      goal: "Sales",
      budget: "$5k to $20k",
      platform: "Any",
      audience: "Millennial"
    },
    nvidia: { apiKey: "test", baseUrl: "https://example.test/v1" },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "discovery-call",
              type: "function",
              function: {
                name: "find_creators",
                arguments: JSON.stringify({
                  product: "ergonomic mouse",
                  goal: "Product launch",
                  budget: "$5k to $20k",
                  platform: "YouTube",
                  audience: "Remote professionals",
                  creatorCriteria: "Review-led content and desk setup relevance"
                })
              }
            }]
          }
        }],
        model: "z-ai/glm-5.2"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  assert.equal(requestBody.tool_choice, "required");
  assert.deepEqual(requestBody.tools.map((tool) => tool.function.name), ["ask_discovery_question", "find_creators"]);
  assert.equal(result.action, "search");
  assert.equal(result.searchPlan.product, "ergonomic mouse");
  assert.equal(result.searchPlan.platform, "YouTube");
  assert.match(result.searchPlan.creatorCriteria, /desk setup/i);
  assert.equal(result.toolsUsed[0].name, "find_creators");
  assert.doesNotMatch(result.answer, /@|followers|engagement/i);
});

test("source-only fallback cites only records in the research session", async () => {
  const session = createSession();
  const result = await runGroundedCampaignAgent({
    sessionId: session.id,
    messages: [{ role: "user", content: "Why is Desk Tech a fit?" }],
    nvidia: {}
  });

  assert.equal(result.status, "ok");
  assert.equal(result.providerUsed, false);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].url, influencer.sourceUrl);
  assert.match(result.answer, /\[E1\]/);
});

test("out-of-scope questions are refused without calling the model", async () => {
  const session = createSession();
  let calls = 0;
  const result = await runGroundedCampaignAgent({
    sessionId: session.id,
    messages: [{ role: "user", content: "What is the weather in Tokyo?" }],
    nvidia: { apiKey: "test" },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("should not be called");
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.providerUsed, false);
  assert.equal(result.citations.length, 0);
  assert.match(result.answer, /only answer from the Bright Data evidence/i);
});

test("research sessions cannot be read by a different owner", async () => {
  const session = upsertResearchSession({
    id: "4c661716-080e-42b4-b1cf-37481a829a17",
    ownerKey: "user:alpha",
    input,
    influencerSources: [{
      title: influencer.sourceTitle,
      source: "tiktok.com",
      description: influencer.sourceDescription,
      link: influencer.sourceUrl,
      rank: 1
    }],
    influencers: [influencer]
  });
  const result = await runGroundedCampaignAgent({
    sessionId: session.id,
    ownerKey: "user:beta",
    messages: [{ role: "user", content: "Why is Desk Tech a fit?" }],
    nvidia: {}
  });

  assert.equal(result.status, "missing");
});

test("GLM tool calls are executed and final citations are validated", async () => {
  const session = createSession();
  const responses = [
    {
      choices: [{
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "inspect_creator", arguments: JSON.stringify({ creator: "Desk Tech" }) }
          }]
        }
      }],
      model: "z-ai/glm-5.2"
    },
    {
      choices: [{
        message: {
          role: "assistant",
          content: JSON.stringify({
            answer: "Desk Tech has a visible product demonstration in the current result. [E1]",
            citationIds: ["E1", "E999"],
            suggestions: ["Draft an outreach angle"]
          })
        }
      }],
      model: "z-ai/glm-5.2"
    }
  ];
  let requestIndex = 0;
  const requestBodies = [];
  const result = await runGroundedCampaignAgent({
    sessionId: session.id,
    messages: [{ role: "user", content: "Inspect Desk Tech" }],
    nvidia: { apiKey: "test", baseUrl: "https://example.test/v1" },
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      const payload = responses[requestIndex++];
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  assert.equal(result.providerUsed, true);
  assert.equal(result.model, "z-ai/glm-5.2");
  assert.deepEqual(result.citations.map((citation) => citation.id), ["E1"]);
  assert.equal(result.toolsUsed[0].name, "inspect_creator");
  assert.equal(requestBodies[0].tool_choice, "required");
  assert.ok(requestBodies[0].tools.some((tool) => tool.function.name === "recommend_shortlist"));
  assert.equal(requestBodies[1].response_format.type, "json_object");
});

test("source-only outreach stays tied to one saved creator record", async () => {
  const session = createSession();
  const result = await draftGroundedOutreach({
    sessionId: session.id,
    creator: "Desk Tech",
    campaignName: "Quiet desk launch",
    nvidia: {}
  });

  assert.equal(result.status, "ok");
  assert.equal(result.providerUsed, false);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].url, influencer.sourceUrl);
  assert.match(result.body, /Quiet wireless mouse desk setup/i);
  assert.doesNotMatch(result.body, /followers|engagement rate|email/i);
});

test("GLM outreach requires the selected creator citation", async () => {
  const session = createSession();
  const responses = [
    {
      choices: [{
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "outreach-call",
            type: "function",
            function: { name: "draft_outreach", arguments: JSON.stringify({ creator: "Desk Tech" }) }
          }]
        }
      }],
      model: "z-ai/glm-5.2"
    },
    {
      choices: [{
        message: {
          role: "assistant",
          content: JSON.stringify({
            subject: "Wireless mouse collaboration",
            body: "Hi Desk, your public desk setup looks relevant to our wireless mouse campaign. [E1]",
            citationIds: ["E1", "E999"]
          })
        }
      }],
      model: "z-ai/glm-5.2"
    }
  ];
  let requestIndex = 0;
  const result = await draftGroundedOutreach({
    sessionId: session.id,
    creator: "Desk Tech",
    campaignName: "Quiet desk launch",
    nvidia: { apiKey: "test", baseUrl: "https://example.test/v1" },
    fetchImpl: async () => new Response(JSON.stringify(responses[requestIndex++]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  assert.equal(result.providerUsed, true);
  assert.deepEqual(result.citations.map((citation) => citation.id), ["E1"]);
  assert.doesNotMatch(result.body, /\[E1\]/);
  assert.equal(result.toolsUsed[0].name, "draft_outreach");
});

test("source-only campaign brief labels unresolved requirements and stays tied to saved evidence", async () => {
  const session = createSession();
  const result = await draftGroundedCampaignBrief({
    sessionId: session.id,
    messages: [{ role: "user", content: "Plan a sales campaign, but I have not decided dates or usage rights." }],
    nvidia: {}
  });

  assert.equal(result.status, "ok");
  assert.equal(result.providerUsed, false);
  assert.equal(result.brief.campaignName, "wireless mouse Sales campaign");
  assert.equal(result.citations[0].url, influencer.sourceUrl);
  assert.ok(result.brief.assumptions.some((assumption) => /timing/i.test(assumption)));
  assert.ok(result.brief.assumptions.some((assumption) => /usage rights/i.test(assumption)));
  assert.equal(result.toolsUsed[0].name, "prepare_campaign_brief");
});

test("GLM campaign brief uses a bounded tool and filters unsupported citations and assistant claims", async () => {
  const session = createSession();
  let requestBody;
  const result = await draftGroundedCampaignBrief({
    sessionId: session.id,
    messages: [
      { role: "user", content: "Target remote workers in the US with one TikTok demo in September." },
      { role: "assistant", content: "Desk Tech has ten million followers and guaranteed conversions." }
    ],
    nvidia: { apiKey: "test", baseUrl: "https://example.test/v1" },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "brief-call",
              type: "function",
              function: {
                name: "prepare_campaign_brief",
                arguments: JSON.stringify({
                  campaignName: "Remote work mouse campaign",
                  objective: "Drive qualified product consideration",
                  audience: "US remote workers",
                  platforms: ["TikTok"],
                  geography: "United States",
                  budget: { label: "$1k to $5k", creatorSpend: "Confirm after creator quotes" },
                  timing: { launchDate: "September", campaignWindow: "Four weeks" },
                  deliverables: ["One TikTok product demonstration"],
                  creatorCriteria: "Visible desk setup and wireless mouse relevance",
                  keyMessage: "A wireless mouse for a quieter desk setup",
                  successMeasures: ["Qualified product interest"],
                  assumptions: ["Exact September dates require confirmation", "Rates and availability are unverified"],
                  citationIds: ["E1", "E999"]
                })
              }
            }]
          }
        }],
        model: "z-ai/glm-5.2"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  assert.equal(result.providerUsed, true);
  assert.equal(requestBody.tool_choice, "required");
  assert.deepEqual(requestBody.tools.map((tool) => tool.function.name), ["prepare_campaign_brief"]);
  assert.deepEqual(result.citations.map((citation) => citation.id), ["E1"]);
  assert.equal(result.brief.geography, "United States");
  assert.doesNotMatch(JSON.stringify(requestBody.messages), /ten million followers|guaranteed conversions/i);
});
