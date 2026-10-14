import type { ArticleVisualData } from '../../src/components/articles/articleVisuals'

// Source-backed article visuals used by the isolated reader regression probe.
export const appZetaVisuals: ArticleVisualData[] = [
  {
    "type": "flow",
    "title": "Two routes from data to marketing value",
    "subtitle": "Conceptual business-model comparison; arrows describe workflows, not measured conversion rates.",
    "lanes": [
      {
        "label": "APP · advertising performance",
        "steps": [
          "Advertiser budget",
          "Axon predictions",
          "Ad placement",
          "Customer response"
        ],
        "outcome": "Advertiser return and publisher monetization support repeat spending."
      },
      {
        "label": "ZETA · enterprise marketing",
        "steps": [
          "Customer data & identity",
          "Athena insights",
          "Campaign activation",
          "Measurement & retention"
        ],
        "outcome": "Integrated workflows can support customer expansion and ongoing platform use."
      }
    ],
    "note": "Analytical illustration based on company product descriptions. An enterprise can use both platforms; this diagram does not imply identical products or economics.",
    "sources": [
      {
        "label": "Axon AI",
        "url": "https://max.applovin.com/p/how-applovin-shows-you-ads"
      },
      {
        "label": "Athena documentation",
        "url": "https://knowledgebase.zetaglobal.com/kb/athena-by-zetatm"
      }
    ]
  },
  {
    "type": "comparison",
    "title": "Financial scale: APP vs ZETA",
    "subtitle": "Quarter ended June 30, 2026 · USD millions · rounded reported results",
    "unit": "USD million",
    "metrics": [
      {
        "label": "Revenue",
        "values": [
          {
            "label": "APP",
            "value": 1923.7
          },
          {
            "label": "ZETA",
            "value": 442.8
          }
        ]
      },
      {
        "label": "Adjusted EBITDA (non-GAAP)",
        "values": [
          {
            "label": "APP",
            "value": 1614
          },
          {
            "label": "ZETA",
            "value": 91.7
          }
        ]
      },
      {
        "label": "GAAP net income",
        "values": [
          {
            "label": "APP",
            "value": 1266.5
          },
          {
            "label": "ZETA",
            "value": 8.2
          }
        ]
      },
      {
        "label": "Free cash flow (non-GAAP)",
        "values": [
          {
            "label": "APP",
            "value": 863.3
          },
          {
            "label": "ZETA",
            "value": 58
          }
        ]
      }
    ],
    "note": "Each metric uses its own zero-based axis; the two company bars within a metric share that scale. Metrics overlap and must not be added together. Company definitions of adjusted EBITDA and free cash flow differ.",
    "sources": [
      {
        "label": "APP Q2 2026",
        "url": "https://investors.applovin.com/news/news-details/2026/AppLovin-Announces-Second-Quarter-2026-Financial-Results/"
      },
      {
        "label": "ZETA Q2 2026",
        "url": "https://investors.zetaglobal.com/news/news-details/2026/Zeta-Global-Reports-20th-Consecutive-Beat-and-Raise-Quarter-Achieves-the-Rule-of-64-and-Generates-Positive-GAAP-Net-Income-in-2Q26/default.aspx"
      }
    ]
  },
  {
    "type": "comparison",
    "title": "Growth: a same-quarter snapshot",
    "subtitle": "Q2 2026 reported revenue growth · year over year",
    "unit": "%",
    "metrics": [
      {
        "label": "Revenue growth",
        "values": [
          {
            "label": "APP",
            "value": 53
          },
          {
            "label": "ZETA",
            "value": 44
          }
        ]
      }
    ],
    "note": "Reported total growth includes differences in business mix and acquisition effects. This is not an organic-growth comparison and is not a forecast.",
    "sources": [
      {
        "label": "APP Q2 2026",
        "url": "https://investors.applovin.com/news/news-details/2026/AppLovin-Announces-Second-Quarter-2026-Financial-Results/"
      },
      {
        "label": "ZETA Q2 2026",
        "url": "https://investors.zetaglobal.com/news/news-details/2026/Zeta-Global-Reports-20th-Consecutive-Beat-and-Raise-Quarter-Achieves-the-Rule-of-64-and-Generates-Positive-GAAP-Net-Income-in-2Q26/default.aspx"
      }
    ]
  },
  {
    "type": "comparison",
    "title": "Profitability and cash generation",
    "subtitle": "Q2 2026 · each measure as a percentage of company revenue",
    "unit": "%",
    "metrics": [
      {
        "label": "Adjusted EBITDA margin (non-GAAP)",
        "values": [
          {
            "label": "APP",
            "value": 83.9
          },
          {
            "label": "ZETA",
            "value": 20.7
          }
        ]
      },
      {
        "label": "GAAP net margin",
        "values": [
          {
            "label": "APP",
            "value": 65.8
          },
          {
            "label": "ZETA",
            "value": 1.8
          }
        ]
      },
      {
        "label": "Free-cash-flow margin (non-GAAP)",
        "values": [
          {
            "label": "APP",
            "value": 44.9
          },
          {
            "label": "ZETA",
            "value": 13.1
          }
        ]
      }
    ],
    "note": "All bars share a 0–100% scale. APP margins are calculated from the article’s rounded figures; ZETA margins follow the release. Different cost structures, revenue presentation and non-GAAP definitions limit comparability.",
    "sources": [
      {
        "label": "APP Q2 2026",
        "url": "https://investors.applovin.com/news/news-details/2026/AppLovin-Announces-Second-Quarter-2026-Financial-Results/"
      },
      {
        "label": "ZETA Q2 2026",
        "url": "https://investors.zetaglobal.com/news/news-details/2026/Zeta-Global-Reports-20th-Consecutive-Beat-and-Raise-Quarter-Achieves-the-Rule-of-64-and-Generates-Positive-GAAP-Net-Income-in-2Q26/default.aspx"
      }
    ]
  },
  {
    "type": "sensitivity",
    "title": "Growth can be offset by a lower multiple",
    "subtitle": "Illustrative value change, not a price target or a forecast for APP or ZETA",
    "growth": [
      -10,
      0,
      20,
      40
    ],
    "multipleChange": [
      -25,
      -10,
      0,
      10
    ],
    "note": "Value change = (1 + profit growth) × (1 + multiple change) − 1. Example: 20% profit growth and a 25% multiple decline imply a 10% value decline. Holds debt, cash and share count constant. Scenario inputs are analyst-selected assumptions, not company guidance.",
    "sources": []
  }
]

