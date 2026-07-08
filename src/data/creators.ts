export type PurchaseIntent = "Low" | "Medium" | "High";
export type CampaignRisk = "Low" | "Medium" | "High";
export type Platform = "TikTok" | "Instagram" | "YouTube";

export type Creator = {
  id: string;
  name: string;
  mockHandle: string;
  platforms: Platform[];
  niche: string;
  followers: string;
  audienceFit: number;
  purchaseIntent: PurchaseIntent;
  campaignRisk: CampaignRisk;
  estimatedCost: string;
  costEstimate: number;
  bestCampaign: string;
  whyMatch: string;
  audienceSignals: string[];
  contentThemes: string[];
  suggestedAngle: string;
};

export const creators: Creator[] = [
  {
    id: "maya-r",
    name: "Maya R.",
    mockHandle: "@maya.mock",
    platforms: ["Instagram", "TikTok"],
    niche: "Petite fashion",
    followers: "84k",
    audienceFit: 91,
    purchaseIntent: "High",
    campaignRisk: "Low",
    estimatedCost: "$800 to $1,200",
    costEstimate: 900,
    bestCampaign: "Try on reel plus affiliate link",
    whyMatch:
      "Audience repeatedly asks about petite sizing, office outfits, breathable fabrics, and direct shopping links.",
    audienceSignals: [
      "Where is this blazer from?",
      "Can you style this for work?",
      "Is this petite friendly?",
      "Need this for summer office fits.",
      "Do you have a link?"
    ],
    contentThemes: [
      "Petite workwear",
      "Office outfits",
      "Capsule wardrobe",
      "Warm weather styling"
    ],
    suggestedAngle: "Petite friendly warm weather workwear for office days."
  },
  {
    id: "elena-k",
    name: "Elena K.",
    mockHandle: "@elena.mock",
    platforms: ["TikTok"],
    niche: "Capsule wardrobe",
    followers: "52k",
    audienceFit: 87,
    purchaseIntent: "Medium",
    campaignRisk: "Medium",
    estimatedCost: "$500 to $900",
    costEstimate: 700,
    bestCampaign: "Styling video",
    whyMatch:
      "Audience is interested in minimal wardrobes, repeatable outfits, and affordable elevated basics.",
    audienceSignals: [
      "Can you make a work capsule?",
      "Where do you buy basics?",
      "Need this in neutral colors.",
      "Can this be styled for summer?",
      "Is there a budget version?"
    ],
    contentThemes: ["Capsule wardrobes", "Minimal fashion", "Budget outfits", "Workwear"],
    suggestedAngle: "A linen blazer as a repeatable capsule wardrobe piece."
  },
  {
    id: "priya-s",
    name: "Priya S.",
    mockHandle: "@priya.mock",
    platforms: ["Instagram", "YouTube"],
    niche: "Modest fashion",
    followers: "38k",
    audienceFit: 84,
    purchaseIntent: "High",
    campaignRisk: "Low",
    estimatedCost: "$400 to $700",
    costEstimate: 550,
    bestCampaign: "Reel plus story set",
    whyMatch:
      "Audience asks for breathable layering pieces, office appropriate fits, and modest summer styling.",
    audienceSignals: [
      "Can you style this modestly?",
      "Is the fabric breathable?",
      "Would this work for office?",
      "Need summer layering ideas.",
      "Where is the full outfit from?"
    ],
    contentThemes: ["Modest styling", "Summer layering", "Office outfits", "Neutral basics"],
    suggestedAngle: "A breathable blazer styled for modest summer workwear."
  },
  {
    id: "zoe-m",
    name: "Zoe M.",
    mockHandle: "@zoe.mock",
    platforms: ["TikTok", "Instagram"],
    niche: "Gen Z fashion",
    followers: "126k",
    audienceFit: 79,
    purchaseIntent: "Medium",
    campaignRisk: "Medium",
    estimatedCost: "$1,200 to $1,800",
    costEstimate: 1500,
    bestCampaign: "Trend styling video",
    whyMatch:
      "Audience engages with seasonal outfit ideas and asks for affordable versions of elevated pieces.",
    audienceSignals: [
      "Need this for internship outfits.",
      "Can you style this casually?",
      "Is there a cheaper option?",
      "Where can I get this look?",
      "Would this work for college?"
    ],
    contentThemes: ["Trend fashion", "Internship outfits", "Affordable styling", "College outfits"],
    suggestedAngle: "A blazer styled from internship day to casual night."
  },
  {
    id: "nora-j",
    name: "Nora J.",
    mockHandle: "@nora.mock",
    platforms: ["YouTube", "Instagram"],
    niche: "Clean beauty education",
    followers: "67k",
    audienceFit: 82,
    purchaseIntent: "High",
    campaignRisk: "Low",
    estimatedCost: "$900 to $1,400",
    costEstimate: 1100,
    bestCampaign: "Routine demo plus pinned shopping link",
    whyMatch:
      "Audience asks for ingredient explainers, sensitive skin routines, and low-friction product comparisons.",
    audienceSignals: [
      "Would this work for sensitive skin?",
      "Can you compare this with a serum?",
      "What step of the routine is this?",
      "Is this fragrance free?",
      "Can you link your morning routine?"
    ],
    contentThemes: ["Skin routines", "Ingredient education", "Sensitive skin", "Beauty comparisons"],
    suggestedAngle: "A low-maintenance routine slot for ingredient-conscious shoppers."
  },
  {
    id: "marco-l",
    name: "Marco L.",
    mockHandle: "@marco.mock",
    platforms: ["TikTok", "YouTube"],
    niche: "Home coffee",
    followers: "44k",
    audienceFit: 78,
    purchaseIntent: "Medium",
    campaignRisk: "Low",
    estimatedCost: "$450 to $850",
    costEstimate: 650,
    bestCampaign: "Comparison video",
    whyMatch:
      "Audience asks for compact gear, beginner setups, and affordable upgrades for small kitchens.",
    audienceSignals: [
      "Is this beginner friendly?",
      "Would it fit in a small apartment?",
      "Can you compare it with your current setup?",
      "Is it easy to clean?",
      "Need a link for the grinder."
    ],
    contentThemes: ["Coffee gear", "Small apartments", "Beginner setups", "Kitchen upgrades"],
    suggestedAngle: "A compact upgrade for better coffee in smaller kitchens."
  },
  {
    id: "talia-b",
    name: "Talia B.",
    mockHandle: "@talia.mock",
    platforms: ["Instagram"],
    niche: "Pilates and wellness",
    followers: "73k",
    audienceFit: 81,
    purchaseIntent: "Medium",
    campaignRisk: "Medium",
    estimatedCost: "$700 to $1,100",
    costEstimate: 900,
    bestCampaign: "Story set plus routine reel",
    whyMatch:
      "Audience asks for realistic routines, comfortable activewear, and low-pressure wellness products.",
    audienceSignals: [
      "What mat do you use?",
      "Can beginners do this?",
      "Is that set supportive?",
      "Need a quick morning routine.",
      "Where did you get the bands?"
    ],
    contentThemes: ["Pilates routines", "Beginner wellness", "Activewear", "Morning habits"],
    suggestedAngle: "A simple habit-based product woven into a realistic wellness routine."
  },
  {
    id: "ivy-c",
    name: "Ivy C.",
    mockHandle: "@ivy.mock",
    platforms: ["TikTok", "Instagram"],
    niche: "Budget decor",
    followers: "58k",
    audienceFit: 76,
    purchaseIntent: "Medium",
    campaignRisk: "Low",
    estimatedCost: "$350 to $650",
    costEstimate: 500,
    bestCampaign: "Room refresh video",
    whyMatch:
      "Audience asks for affordable swaps, renter friendly updates, and direct product sources.",
    audienceSignals: [
      "Is this renter friendly?",
      "Can you do this under $100?",
      "Where is that lamp from?",
      "Need ideas for a small bedroom.",
      "Can you link the full room?"
    ],
    contentThemes: ["Budget decor", "Renter friendly", "Small spaces", "Room refreshes"],
    suggestedAngle: "A small-space refresh with one affordable product anchor."
  },
  {
    id: "samira-h",
    name: "Samira H.",
    mockHandle: "@samira.mock",
    platforms: ["YouTube", "TikTok"],
    niche: "Travel packing",
    followers: "93k",
    audienceFit: 80,
    purchaseIntent: "High",
    campaignRisk: "Medium",
    estimatedCost: "$1,000 to $1,600",
    costEstimate: 1300,
    bestCampaign: "Pack with me video",
    whyMatch:
      "Audience asks for packable fabrics, capsule outfits, and links to travel friendly essentials.",
    audienceSignals: [
      "Does this wrinkle in a suitcase?",
      "Can it work for business travel?",
      "How many outfits can you make?",
      "Is it carry-on friendly?",
      "Can you link the packing cubes?"
    ],
    contentThemes: ["Packing lists", "Travel capsules", "Business travel", "Wrinkle resistant outfits"],
    suggestedAngle: "A packable product for business travel capsules."
  },
  {
    id: "leo-a",
    name: "Leo A.",
    mockHandle: "@leo.mock",
    platforms: ["Instagram", "YouTube"],
    niche: "Desk setup productivity",
    followers: "61k",
    audienceFit: 75,
    purchaseIntent: "Medium",
    campaignRisk: "Low",
    estimatedCost: "$600 to $950",
    costEstimate: 775,
    bestCampaign: "Setup walkthrough",
    whyMatch:
      "Audience asks for ergonomic upgrades, desk organization, and practical buying links.",
    audienceSignals: [
      "What stand is that?",
      "Can you show cable management?",
      "Is this good for small desks?",
      "Need an ergonomic upgrade.",
      "Can you link your setup?"
    ],
    contentThemes: ["Desk setups", "Productivity", "Ergonomics", "Small workspaces"],
    suggestedAngle: "A practical workspace upgrade for focused work days."
  }
];

export function getCreatorById(id: string) {
  return creators.find((creator) => creator.id === id);
}

